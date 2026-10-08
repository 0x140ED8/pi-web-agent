import fs from "node:fs";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { AUTH_PATH, CONFIG, MODELS_STORE_PATH, PROVIDERS_PATH } from "./config.js";
import { readProviders } from "./providers.js";

type PiModel = NonNullable<AgentSession["model"]>;

/**
 * Owns the shared ModelRuntime (providers/models/keys from config/providers.json)
 * and the set of open AgentSessions backed by persistent JSONL session files.
 */

export interface OpenSession {
	session: AgentSession;
	openedAt: number;
}

export interface OneShotOptions {
	/** Replaces the system prompt entirely (no project context/extensions loaded). */
	systemPrompt?: string;
	provider?: string;
	id?: string;
}

export class AgentManager {
	private runtime!: ModelRuntime;
	private sessions = new Map<string, OpenSession>();

	async init(): Promise<void> {
		fs.mkdirSync(CONFIG.sessionDir, { recursive: true });
		fs.mkdirSync(CONFIG.agentDir, { recursive: true });

		// All state isolated under data/agent; provider definitions come from
		// config/providers.json (pi models.json format). No network on startup.
		this.runtime = await ModelRuntime.create({
			authPath: AUTH_PATH,
			modelsPath: PROVIDERS_PATH,
			modelsStorePath: MODELS_STORE_PATH,
		});
	}

	get modelRuntime(): ModelRuntime {
		return this.runtime;
	}

	/** Hot-reload providers.json into the running runtime (same as pi's /model reload). */
	async refreshProviders(): Promise<void> {
		await this.runtime.refresh({ allowNetwork: false });
	}

	resolveModel(provider: string, id: string): PiModel | undefined {
		return this.runtime.getModel(provider, id);
	}

	/** Default model: last UI selection, else config, else first available. */
	async resolveDefaultModel(): Promise<PiModel | undefined> {
		const persisted = this.readPersistedModel();
		if (persisted) return persisted;
		if (CONFIG.defaultModel) {
			const m = this.runtime.getModel(CONFIG.defaultModel.provider, CONFIG.defaultModel.id);
			if (m) return m;
		}
		const available = await this.runtime.getAvailable();
		return available[0];
	}

	/** Last model picked in the UI, persisted in the agent dir's settings.json. */
	private readPersistedModel(): PiModel | undefined {
		try {
			const settings = SettingsManager.create(CONFIG.workspaceDir, CONFIG.agentDir);
			const provider = settings.getDefaultProvider();
			const id = settings.getDefaultModel();
			if (provider && id) return this.runtime.getModel(provider, id);
		} catch {
			/* fall back to config defaults */
		}
		return undefined;
	}

	/**
	 * Switch a session's model and remember the choice globally: it is persisted
	 * to the agent dir settings (new and reopened sessions use it) and applied
	 * to every other open session so the whole app stays on one model.
	 */
	async switchModelEverywhere(session: AgentSession, model: PiModel): Promise<void> {
		await session.setModel(model, { persist: true });
		await session.settingsManager.flush();
		for (const open of this.sessions.values()) {
			if (open.session === session) continue;
			const current = open.session.model;
			if (current && current.provider === model.provider && current.id === model.id) continue;
			try {
				await open.session.setModel(model);
			} catch {
				/* a session that cannot switch keeps its current model */
			}
		}
	}

	private async buildSession(sessionManager: SessionManager): Promise<AgentSession> {
		const model = await this.resolveDefaultModel();
		const { session } = await createAgentSession({
			cwd: CONFIG.workspaceDir,
			agentDir: CONFIG.agentDir,
			model,
			thinkingLevel: CONFIG.thinkingLevel,
			tools: CONFIG.tools,
			modelRuntime: this.runtime,
			sessionManager,
			settingsManager: SettingsManager.create(CONFIG.workspaceDir, CONFIG.agentDir),
		});
		return session;
	}

	/** Create a new persistent session (JSONL file under sessionDir). */
	async createSession(name?: string): Promise<AgentSession> {
		const sm = SessionManager.create(CONFIG.workspaceDir, CONFIG.sessionDir);
		const session = await this.buildSession(sm);
		if (name) session.setSessionName(name);
		this.sessions.set(session.sessionId, { session, openedAt: Date.now() });
		return session;
	}

	getOpenSession(sessionId: string): AgentSession | undefined {
		return this.sessions.get(sessionId)?.session;
	}

	/** Get an open session, or open a persisted session file by id. */
	async getOrOpenSession(sessionId: string): Promise<AgentSession | undefined> {
		const open = this.sessions.get(sessionId);
		if (open) return open.session;

		const listed = await SessionManager.list(CONFIG.workspaceDir, CONFIG.sessionDir);
		const info = listed.find((s) => s.id === sessionId || s.name === sessionId);
		if (!info) return undefined;

		const sm = SessionManager.open(info.path, CONFIG.sessionDir, CONFIG.workspaceDir);
		const session = await this.buildSession(sm);
		this.sessions.set(session.sessionId, { session, openedAt: Date.now() });
		return session;
	}

	async listSessions(): Promise<Array<Record<string, unknown>>> {
		const listed = await SessionManager.list(CONFIG.workspaceDir, CONFIG.sessionDir);
		return listed.map((s) => ({
			id: s.id,
			name: s.name,
			file: s.path,
			created: s.created,
			modified: s.modified,
			messageCount: s.messageCount,
			firstMessage: s.firstMessage.slice(0, 200),
			isOpen: this.sessions.has(s.id),
		}));
	}

	disposeSession(sessionId: string): boolean {
		const open = this.sessions.get(sessionId);
		if (!open) return false;
		open.session.dispose();
		this.sessions.delete(sessionId);
		return true;
	}

	/**
	 * Reload resources (skills/extensions/settings) for sessions that are not
	 * running, so panel changes apply to the currently open session as well.
	 * A busy session picks the change up the next time it is rebuilt.
	 */
	async reloadIdleSessions(): Promise<number> {
		let reloaded = 0;
		for (const { session } of this.sessions.values()) {
			if (!session.isIdle) continue;
			try {
				await session.reload();
				reloaded++;
			} catch {
				/* keep the other sessions going; the toggle itself succeeded */
			}
		}
		return reloaded;
	}

	/**
	 * Delete a session: dispose it if open and remove its persisted JSONL file.
	 */
	async deleteSession(sessionId: string): Promise<boolean> {
		const open = this.sessions.get(sessionId);
		if (open) {
			open.session.dispose();
			this.sessions.delete(sessionId);
		}
		const listed = await SessionManager.list(CONFIG.workspaceDir, CONFIG.sessionDir);
		const info = listed.find((s) => s.id === sessionId || s.name === sessionId);
		if (!info) return Boolean(open);
		try {
			fs.rmSync(info.path, { force: true });
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * List models for the /model switcher: everything known from providers.json
	 * (plus built-ins), with availability reflecting configured auth.
	 */
	async listModels(): Promise<Array<Record<string, unknown>>> {
		const available = new Set((await this.runtime.getAvailable()).map((m) => `${m.provider}/${m.id}`));
		const configured = new Set(Object.keys(readProviders().providers));
		const models = this.runtime.getModels();
		return models.map((m) => ({
			provider: m.provider,
			id: m.id,
			name: m.name,
			reasoning: m.reasoning,
			input: m.input,
			contextWindow: m.contextWindow,
			maxTokens: m.maxTokens,
			available: available.has(`${m.provider}/${m.id}`),
			source: configured.has(m.provider) ? "providers.json" : "builtin",
		}));
	}

	/**
	 * One-shot, tool-less, in-memory exchange used for auxiliary tasks such as
	 * generating a session name. Loads no extensions/skills/prompts/themes/context
	 * files and replaces the system prompt with the caller-supplied one.
	 */
	async oneShot(message: string, opts: OneShotOptions = {}): Promise<{ text: string; model?: string }> {
		let model: PiModel | undefined;
		if (opts.provider && opts.id) {
			model = this.runtime.getModel(opts.provider, opts.id);
			if (!model) throw new Error(`model ${opts.provider}/${opts.id} not found`);
		} else {
			model = await this.resolveDefaultModel();
		}

		const loader = new DefaultResourceLoader({
			cwd: CONFIG.workspaceDir,
			agentDir: CONFIG.agentDir,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			systemPrompt: opts.systemPrompt ?? "You are a helpful assistant.",
		});
		await loader.reload();

		const { session } = await createAgentSession({
			cwd: CONFIG.workspaceDir,
			agentDir: CONFIG.agentDir,
			model,
			thinkingLevel: "off" as never,
			noTools: "all",
			modelRuntime: this.runtime,
			sessionManager: SessionManager.inMemory(CONFIG.workspaceDir),
			settingsManager: SettingsManager.create(CONFIG.workspaceDir, CONFIG.agentDir),
			resourceLoader: loader,
		});

		try {
			await session.prompt(message);
			return {
				text: session.getLastAssistantText() ?? "",
				model: session.model ? `${session.model.provider}/${session.model.id}` : undefined,
			};
		} finally {
			session.dispose();
		}
	}

	/** Rename a session (persisted as a session_info entry). Opens it if needed. */
	async renameSession(sessionId: string, name: string): Promise<AgentSession | undefined> {
		const session = await this.getOrOpenSession(sessionId);
		if (!session) return undefined;
		session.setSessionName(name);
		return session;
	}

	disposeAll(): void {
		for (const open of this.sessions.values()) open.session.dispose();
		this.sessions.clear();
	}
}
