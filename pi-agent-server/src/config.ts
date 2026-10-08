import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface ModelRef {
	provider: string;
	id: string;
}

export interface ServerConfig {
	host: string;
	port: number;
	/** Working directory the agent's tools operate in. */
	workspaceDir: string;
	/** Directory for persisted session JSONL files. */
	sessionDir: string;
	/** Isolated pi agent directory (settings/skills/extensions/auth cache). */
	agentDir: string;
	defaultModel?: ModelRef;
	thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
	tools: string[];
	rag: RagConfig;
}

/** External RAG retrieval service (D:\MyAPP\rag, FastAPI on :8100). */
export interface RagConfig {
	/** Base URL of the RAG HTTP API. */
	baseUrl: string;
	/** Root directory of the RAG project (spawn cwd, resolves relative paths). */
	projectDir: string;
	/** Python executable of the rag conda env used to auto-start the service. */
	python: string;
	/** Auto-start the RAG service (and wait for it) when it is offline. */
	autoStart: boolean;
}

const DEFAULTS = {
	host: "127.0.0.1",
	port: 8787,
	workspaceDir: "..",
	sessionDir: "data/sessions",
	agentDir: "data/agent",
	thinkingLevel: "off" as const,
	tools: ["read", "powershell", "edit", "write", "grep", "find", "ls"],
	rag: {
		baseUrl: "http://127.0.0.1:8100",
		projectDir: "D:\\MyAPP\\rag",
		python: "C:\\Users\\17764\\.conda\\envs\\rag\\python.exe",
		autoStart: true,
	},
};

function loadRagConfig(raw: Record<string, unknown>): RagConfig {
	const rag = (raw.rag && typeof raw.rag === "object" ? raw.rag : {}) as Record<string, unknown>;
	return {
		baseUrl: typeof rag.baseUrl === "string" && rag.baseUrl ? rag.baseUrl.replace(/\/+$/, "") : DEFAULTS.rag.baseUrl,
		projectDir:
			typeof rag.projectDir === "string" && rag.projectDir
				? path.isAbsolute(rag.projectDir)
					? rag.projectDir
					: path.resolve(PROJECT_ROOT, rag.projectDir)
				: DEFAULTS.rag.projectDir,
		python: typeof rag.python === "string" && rag.python ? rag.python : DEFAULTS.rag.python,
		autoStart: typeof rag.autoStart === "boolean" ? rag.autoStart : DEFAULTS.rag.autoStart,
	};
}

function resolveDir(value: unknown, fallback: string): string {
	if (typeof value === "string" && value.length > 0) {
		return path.isAbsolute(value) ? value : path.resolve(PROJECT_ROOT, value);
	}
	return path.resolve(PROJECT_ROOT, fallback);
}

export function loadServerConfig(): ServerConfig {
	const file = path.join(PROJECT_ROOT, "config", "server.json");
	let raw: Record<string, unknown> = {};
	if (fs.existsSync(file)) {
		raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
	}
	const defaultModel = raw.defaultModel as ModelRef | undefined;
	return {
		host: typeof raw.host === "string" ? raw.host : DEFAULTS.host,
		port: typeof raw.port === "number" ? raw.port : DEFAULTS.port,
		workspaceDir: resolveDir(raw.workspaceDir, DEFAULTS.workspaceDir),
		sessionDir: resolveDir(raw.sessionDir, DEFAULTS.sessionDir),
		agentDir: resolveDir(raw.agentDir, DEFAULTS.agentDir),
		defaultModel:
			defaultModel && typeof defaultModel.provider === "string" && typeof defaultModel.id === "string"
				? defaultModel
				: undefined,
		thinkingLevel: (typeof raw.thinkingLevel === "string" ? raw.thinkingLevel : DEFAULTS.thinkingLevel) as ServerConfig["thinkingLevel"],
		tools: Array.isArray(raw.tools) && raw.tools.length > 0 ? (raw.tools as string[]) : DEFAULTS.tools,
		rag: loadRagConfig(raw),
	};
}

export const CONFIG = loadServerConfig();

/** User-editable provider/model/key config file (pi models.json format). */
export const PROVIDERS_PATH = path.join(PROJECT_ROOT, "config", "providers.json");
/** Credential store location, isolated from ~/.pi/agent. */
export const AUTH_PATH = path.join(CONFIG.agentDir, "auth.json");
/** Remote catalog cache location. */
export const MODELS_STORE_PATH = path.join(CONFIG.agentDir, "models-store.json");
