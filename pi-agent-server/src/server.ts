import http from "node:http";
import { CONFIG, PROJECT_ROOT } from "./config.js";
import { AgentManager } from "./agent-manager.js";
import { listWorkspaceFiles } from "./files.js";
import * as kb from "./knowledge.js";
import { listSkills, setSkillDisabled, SkillError } from "./skills.js";
import {
	readProviders,
	writeProviders,
	publicProvider,
	validateProviderConfig,
	type ProviderUserConfig,
} from "./providers.js";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

/**
 * HTTP API over the embedded pi agent.
 *
 * Provider/model/key management: config/providers.json (pi models.json format),
 * mutated through /api/providers and hot-reloaded into the running ModelRuntime.
 * Model switching mirrors pi's /model (setModel) and Ctrl+P (cycleModel).
 */

const manager = new AgentManager();

// ---------------------------------------------------------------------------
// helpers

function safeJsonStringify(value: unknown): string {
	const seen = new WeakSet();
	return JSON.stringify(value, (_key, v) => {
		if (typeof v === "bigint") return v.toString();
		if (typeof v === "object" && v !== null) {
			if (seen.has(v)) return "[Circular]";
			seen.add(v);
		}
		return v;
	});
}

const MAX_TEXT = 8000;

function truncateText(text: string): string {
	return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + `…[truncated ${text.length - MAX_TEXT} chars]` : text;
}

function simplifyContent(content: unknown): unknown {
	if (typeof content === "string") return truncateText(content);
	if (Array.isArray(content)) {
		return content.map((block) => {
			if (!block || typeof block !== "object") return block;
			const b = block as Record<string, unknown>;
			const out: Record<string, unknown> = { ...b };
			if (typeof out.text === "string") out.text = truncateText(out.text);
			if (typeof out.thinking === "string") out.thinking = truncateText(out.thinking);
			return out;
		});
	}
	return content;
}

function simplifyMessage(message: unknown): unknown {
	if (!message || typeof message !== "object") return message;
	const m = message as Record<string, unknown>;
	return {
		role: m.role,
		content: simplifyContent(m.content),
		toolCallId: m.toolCallId,
		isError: m.isError,
		model: m.model,
		provider: m.provider,
		usage: m.usage,
		stopReason: m.stopReason,
		errorMessage: m.errorMessage,
		timestamp: m.timestamp,
	};
}

/** Project an AgentSessionEvent into a lightweight JSON payload for SSE. */
function serializeEvent(event: Record<string, unknown>): Record<string, unknown> {
	switch (event.type) {
		case "message_update": {
			const ame = event.assistantMessageEvent as Record<string, unknown> | undefined;
			if (!ame) return { type: event.type };
			const out: Record<string, unknown> = { type: event.type, assistantMessageEvent: { type: ame.type } };
			const target = out.assistantMessageEvent as Record<string, unknown>;
			if (typeof ame.contentIndex === "number") target.contentIndex = ame.contentIndex;
			if (typeof ame.delta === "string") target.delta = ame.delta;
			if (typeof ame.content === "string") target.content = truncateText(ame.content);
			if (ame.toolCall) target.toolCall = ame.toolCall;
			return out;
		}
		case "message_start":
		case "message_end":
			return { type: event.type, message: simplifyMessage(event.message) };
		case "tool_execution_start":
			return { type: event.type, toolCallId: event.toolCallId, toolName: event.toolName, args: event.args };
		case "tool_execution_update":
			return {
				type: event.type,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				partialResult: simplifyContent(event.partialResult),
			};
		case "tool_execution_end": {
			const result = event.result as Record<string, unknown> | undefined;
			return {
				type: event.type,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				isError: event.isError,
				result: result
					? {
							content: simplifyContent(result.content),
							isError: result.isError,
							details: result.details,
						}
					: undefined,
			};
		}
		case "turn_end":
			return {
				type: event.type,
				message: simplifyMessage(event.message),
				toolResultCount: Array.isArray(event.toolResults) ? event.toolResults.length : 0,
			};
		case "agent_end":
			return {
				type: event.type,
				messageCount: Array.isArray(event.messages) ? event.messages.length : 0,
				willRetry: event.willRetry,
			};
		default:
			// agent_start, turn_start, agent_settled, queue_update, compaction_*,
			// auto_retry_*, thinking_level_changed, ...
			return { ...event };
	}
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	if (chunks.length === 0) return {};
	try {
		const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
	} catch {
		throw new HttpError(400, "request body must be valid JSON");
	}
}

class HttpError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

function notFound(what = "resource"): never {
	throw new HttpError(404, `${what} not found`);
}

// ---------------------------------------------------------------------------
// request handlers

type Ctx = { req: http.IncomingMessage; res: http.ServerResponse; parts: string[]; query: URLSearchParams };

function requireSession(id: string | undefined): Promise<AgentSession> {
	if (!id) notFound("session");
	return manager.getOrOpenSession(id).then((s) => {
		if (!s) notFound("session");
		return s;
	});
}

/** Model + thinking state shared by session responses (drives the UI selectors). */
function sessionMeta(session: AgentSession): {
	model: string | null;
	thinkingLevel: string;
	availableThinkingLevels: string[];
} {
	return {
		model: session.model ? `${session.model.provider}/${session.model.id}` : null,
		thinkingLevel: session.thinkingLevel,
		availableThinkingLevels: session.getAvailableThinkingLevels(),
	};
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
	const payload = safeJsonStringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	});
	res.end(payload);
}

async function handlePrompt(ctx: Ctx, session: AgentSession): Promise<void> {
	const { req, res, query } = ctx;
	const body = await readBody(req);
	const message = body.message ?? body.text ?? body.prompt;
	if (typeof message !== "string" || message.length === 0) {
		throw new HttpError(400, "field 'message' (string) is required");
	}
	const streamingBehavior = body.streamingBehavior as "steer" | "followUp" | undefined;
	const wantsStream = body.stream !== false && query.get("stream") !== "false";
	const knowledgeBaseId = typeof body.knowledgeBaseId === "string" ? body.knowledgeBaseId : undefined;
	// Slash commands ("/skill:...", "/model"...) must reach the session as-is;
	// a prepended context block would break command detection.
	const kbWanted = Boolean(knowledgeBaseId) && !message.trimStart().startsWith("/");

	if (!session.isIdle && !streamingBehavior) {
		throw new HttpError(409, "session is busy; pass streamingBehavior (steer|followUp) to queue, or abort first");
	}

	// Knowledge-base retrieval: rewrite -> retrieve -> inject as a marked
	// context block. Best-effort — on any failure the prompt proceeds as-is.
	// 409 during an ingest (single-concurrency service) degrades silently too.
	let promptMessage = message;
	let kbInfo: Record<string, unknown> | undefined;
	if (kbWanted) {
		try {
			const result = await kb.queryKb(message, {
				kbId: knowledgeBaseId,
				rewrite: true,
				oneShot: (msg, opts) => manager.oneShot(msg, { systemPrompt: opts.systemPrompt }),
			});
			const context = kb.formatContext(
				result.hits,
				result.kbName,
				result.rewriteSkipped ? undefined : result.rewrittenQuery,
			);
			if (context) {
				// Question first, context after: the SDK's session-list preview
				// (firstMessage, truncated) then shows the question, and the
				// strip regex still removes the whole marked block.
				promptMessage = `${message}\n\n${context}`;
				kbInfo = {
					status: "ok",
					kbId: result.kbId,
					kbName: result.kbName,
					rewrittenQuery: result.rewriteSkipped ? undefined : result.rewrittenQuery,
					hits: result.hits.length,
					tookMs: result.took_ms,
					// Raw hits so the web UI can show the retrieval results
					// (text + source/heading index) behind the answer.
					results: result.hits,
				};
			} else {
				kbInfo = { status: "empty", kbId: result.kbId, kbName: result.kbName, hits: 0 };
			}
		} catch (err) {
			kbInfo = {
				status: "error",
				message: err instanceof Error ? err.message : String(err),
			};
		}
	}

	if (!wantsStream) {
		// Non-streaming: wait for the run to finish, return final state.
		await session.prompt(promptMessage, { streamingBehavior });
		sendJson(res, 200, {
			sessionId: session.sessionId,
			model: session.model ? `${session.model.provider}/${session.model.id}` : undefined,
			messages: session.messages.map(simplifyMessage),
			lastAssistantText: session.getLastAssistantText(),
			kb: kbInfo,
		});
		return;
	}

	// SSE streaming
	res.writeHead(200, {
		"Content-Type": "text/event-stream; charset=utf-8",
		"Cache-Control": "no-store",
		Connection: "keep-alive",
		"X-Accel-Buffering": "no",
	});
	const send = (event: string, data: unknown) => {
		res.write(`event: ${event}\ndata: ${safeJsonStringify(data)}\n\n`);
	};
	send("open", { sessionId: session.sessionId });
	if (kbInfo) send("kb_context", kbInfo);

	let settled = false;
	let unsubscribe: (() => void) | undefined;
	let promptError: unknown = undefined;

	const settledPromise = new Promise<void>((resolve) => {
		unsubscribe = session.subscribe((ev) => {
			send(ev.type, serializeEvent(ev as unknown as Record<string, unknown>));
			if (ev.type === "agent_settled") {
				settled = true;
				resolve();
			}
		});
	});

	const clientGone = new Promise<void>((resolve) => {
		req.on("close", () => resolve());
	});

	const promptPromise = session
		.prompt(promptMessage, { streamingBehavior })
		.catch((err: unknown) => {
			promptError = err;
		});

	// Wait for settlement, prompt completion (incl. error), or client disconnect.
	await Promise.race([
		Promise.all([settledPromise, promptPromise]).then(() => undefined),
		clientGone.then(async () => {
			if (!settled) {
				try {
					await session.abort();
				} catch {
					/* ignore */
				}
			}
		}),
	]);

	unsubscribe?.();
	if (promptError) {
		send("error", {
			message: promptError instanceof Error ? promptError.message : String(promptError),
		});
	}
	send("done", { sessionId: session.sessionId, settled });
	res.end();
}

async function handleProviderMutation(ctx: Ctx): Promise<void> {
	const { req, res, parts } = ctx;
	const id = parts[2];
	if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) {
		throw new HttpError(400, "invalid provider id");
	}
	const method = req.method;
	const file = readProviders();

	if (method === "DELETE") {
		if (!file.providers[id]) notFound("provider");
		delete file.providers[id];
		writeProviders(file);
		await manager.refreshProviders();
		sendJson(res, 200, { ok: true, deleted: id });
		return;
	}

	const body = await readBody(req);

	if (method === "PUT") {
		// Full create/replace
		if (Object.keys(body).length === 0) throw new HttpError(400, "provider config body required");
		const error = validateProviderConfig(body);
		if (error) throw new HttpError(400, error);
		const cfg = body as unknown as ProviderUserConfig;
		cfg.name = typeof cfg.name === "string" ? cfg.name : id;
		file.providers[id] = cfg;
	} else if (method === "PATCH") {
		// Partial update: merge top-level fields; apiKey can be replaced or omitted.
		const existing = file.providers[id];
		if (!existing) notFound("provider");
		if (Object.keys(body).length === 0) throw new HttpError(400, "patch body required");
		if (body.apiKey === null || body.apiKey === "") delete existing.apiKey;
		for (const [key, value] of Object.entries(body)) {
			if (value === null) delete (existing as Record<string, unknown>)[key];
			else (existing as Record<string, unknown>)[key] = value;
		}
		const error = validateProviderConfig(existing);
		if (error) throw new HttpError(400, `merged config invalid: ${error}`);
	} else {
		throw new HttpError(405, "method not allowed");
	}

	writeProviders(file);
	await manager.refreshProviders();
	const updated = readProviders().providers[id];
	sendJson(res, 200, publicProvider(id, updated));
}

/**
 * /api/kb routes. Order matters: the literal segments (query, jobs, service,
 * config) are matched before the /:id form, since parts[2] would otherwise
 * capture them as a KB id.
 */
async function handleKbRoutes(ctx: Ctx): Promise<void> {
	const { req, res, parts } = ctx;
	const method = req.method ?? "GET";
	const id = parts[2];
	const sub = parts[3];

	const kbOneShot = (message: string, opts: { systemPrompt?: string }) =>
		manager.oneShot(message, { systemPrompt: opts.systemPrompt });

	if (id === undefined || id === "") {
		if (method === "GET") {
			const [registry, service] = await Promise.all([kb.loadRegistry(), kb.getServiceStatus()]);
			sendJson(res, 200, {
				service,
				activeId: registry.activeId,
				knowledgeBases: registry.knowledgeBases.map((base) => ({
					...base,
					docCount: kb.listDocumentsSync(base.paths.data_dir).length,
				})),
			});
			return;
		}
		if (method === "POST") {
			const body = await readBody(req);
			if (typeof body.name !== "string" || !body.name.trim()) {
				throw new HttpError(400, "field 'name' (string) is required");
			}
			const created = await kb.createKnowledgeBase({
				name: body.name,
				description: typeof body.description === "string" ? body.description : undefined,
			});
			sendJson(res, 201, created);
			return;
		}
		throw new HttpError(405, "method not allowed");
	}

	if (id === "query") {
		if (method !== "POST") throw new HttpError(405, "method not allowed");
		const body = await readBody(req);
		const query = body.query ?? body.message ?? body.text;
		if (typeof query !== "string" || !query.trim()) {
			throw new HttpError(400, "field 'query' (string) is required");
		}
		const result = await kb.queryKb(query, {
			kbId: typeof body.kbId === "string" ? body.kbId : undefined,
			rewrite: body.rewrite !== false,
			topK: typeof body.topK === "number" ? body.topK : undefined,
			rerank: typeof body.rerank === "boolean" ? body.rerank : undefined,
			oneShot: kbOneShot,
		});
		sendJson(res, 200, result);
		return;
	}

	if (id === "jobs") {
		if (method !== "GET") throw new HttpError(405, "method not allowed");
		if (!sub) throw new HttpError(400, "job id required");
		sendJson(res, 200, await kb.getJob(sub));
		return;
	}

	if (id === "service") {
		if (sub !== "start" || method !== "POST") throw new HttpError(405, "method not allowed");
		const started = await kb.launchRagService();
		const service = await kb.getServiceStatus();
		sendJson(res, 200, { ok: started, service });
		return;
	}

	if (id === "config") {
		if (sub) notFound("endpoint");
		if (method === "GET") {
			sendJson(res, 200, await kb.getRagConfig());
			return;
		}
		if (method === "POST") {
			const body = await readBody(req);
			sendJson(res, 200, await kb.updateRagConfig(body));
			return;
		}
		throw new HttpError(405, "method not allowed");
	}

	switch (sub) {
		case undefined:
		case "": {
			if (method === "DELETE") {
				sendJson(res, 200, await kb.deleteKnowledgeBase(id));
				return;
			}
			if (method === "PATCH" || method === "PUT") {
				const body = await readBody(req);
				if (Object.keys(body).length === 0) throw new HttpError(400, "patch body required");
				sendJson(res, 200, await kb.updateKnowledgeBase(id, body as never));
				return;
			}
			throw new HttpError(405, "method not allowed");
		}
		case "activate": {
			if (method !== "POST") throw new HttpError(405, "method not allowed");
			const warnings = await kb.ensureActive(id);
			sendJson(res, 200, { ok: true, activeId: id, warnings });
			return;
		}
		case "documents": {
			const docName = parts[4];
			if (docName !== undefined) {
				if (method === "DELETE") {
					await kb.deleteDocument(id, decodeURIComponent(docName));
					sendJson(res, 200, { ok: true });
					return;
				}
				throw new HttpError(405, "method not allowed");
			}
			if (method === "GET") {
				sendJson(res, 200, { documents: await kb.listDocuments(id) });
				return;
			}
			if (method === "POST") {
				const body = await readBody(req);
				const doc = await kb.writeDocument(id, body.name, body.contentBase64);
				sendJson(res, 201, doc);
				return;
			}
			throw new HttpError(405, "method not allowed");
		}
		case "ingest": {
			if (method !== "POST") throw new HttpError(405, "method not allowed");
			sendJson(res, 202, await kb.ingestKnowledgeBase(id));
			return;
		}
		case "refresh": {
			if (method !== "POST") throw new HttpError(405, "method not allowed");
			sendJson(res, 200, await kb.refreshKnowledgeBase(id));
			return;
		}
		default:
			notFound("endpoint");
	}
}

async function route(ctx: Ctx): Promise<void> {
	const { req, res, parts, query } = ctx;
	const method = req.method ?? "GET";
	const [_, seg1, id, sub] = parts;

	if (!seg1 || seg1 === "") {
		if (method === "GET") {
			sendJson(res, 200, {
				name: "pi-agent-server",
				piEmbedding: "SDK in-process (route A)",
				workspace: CONFIG.workspaceDir,
				endpoints: [
					"GET  /api/health",
					"POST /api/chat {message, systemPrompt?, provider?, id?} - one-shot, tool-less",
					"GET  /api/providers | PUT|PATCH|DELETE /api/providers/:id",
					"GET  /api/models",
					"GET  /api/files - workspace file index for @ mentions",
				"GET  /api/skills | PATCH /api/skills {filePath, disableModelInvocation}",
				"GET|POST /api/kb | PATCH|DELETE /api/kb/:id | POST /api/kb/:id/activate",
				"GET|POST /api/kb/:id/documents | DELETE /api/kb/:id/documents/:name",
				"POST /api/kb/:id/ingest | POST /api/kb/:id/refresh | GET /api/kb/jobs/:jobId | POST /api/kb/query",
				"POST /api/kb/service/start | GET|POST /api/kb/config",
				"POST /api/sessions | GET /api/sessions | DELETE /api/sessions/:id",
					"GET  /api/sessions/:id/messages | /stats",
					"POST /api/sessions/:id/prompt (SSE, {message, stream?, streamingBehavior?})",
					"POST /api/sessions/:id/model {provider,id} | /model/cycle | /thinking {level}",
					"POST /api/sessions/:id/compact | /abort | /rename {name}",
				],
			});
			return;
		}
		throw new HttpError(405, "method not allowed");
	}

	if (seg1 === "health" && method === "GET") {
		sendJson(res, 200, { ok: true, uptime: process.uptime() });
		return;
	}

	if (seg1 === "chat") {
		if (method !== "POST") throw new HttpError(405, "method not allowed");
		const body = await readBody(req);
		const message = body.message ?? body.text ?? body.prompt;
		if (typeof message !== "string" || message.length === 0) {
			throw new HttpError(400, "field 'message' (string) is required");
		}
		const modelRef = body.id ?? body.model;
		const result = await manager.oneShot(message, {
			systemPrompt: typeof body.systemPrompt === "string" ? body.systemPrompt : undefined,
			provider: typeof body.provider === "string" ? body.provider : undefined,
			id: typeof modelRef === "string" ? modelRef : undefined,
		});
		sendJson(res, 200, result);
		return;
	}

	if (seg1 === "providers") {
		if (method === "GET") {
			const file = readProviders();
			sendJson(res, 200, {
				providers: Object.entries(file.providers).map(([id, cfg]) => publicProvider(id, cfg)),
			});
			return;
		}
		if (method === "PUT" || method === "PATCH" || method === "DELETE") {
			await handleProviderMutation(ctx);
			return;
		}
		throw new HttpError(405, "method not allowed");
	}

	if (seg1 === "models" && method === "GET") {
		sendJson(res, 200, { models: await manager.listModels() });
		return;
	}

	if (seg1 === "files" && method === "GET") {
		sendJson(res, 200, listWorkspaceFiles());
		return;
	}

	if (seg1 === "skills") {
		if (method === "GET") {
			sendJson(res, 200, { skills: await listSkills() });
			return;
		}
		if (method === "PATCH") {
			const body = await readBody(req);
			const filePath = typeof body.filePath === "string" ? body.filePath : "";
			if (!filePath) throw new HttpError(400, "field 'filePath' (string) is required");
			if (typeof body.disableModelInvocation !== "boolean") {
				throw new HttpError(400, "field 'disableModelInvocation' (boolean) is required");
			}
			try {
				const skill = await setSkillDisabled(filePath, body.disableModelInvocation);
				const reloadedSessions = await manager.reloadIdleSessions();
				sendJson(res, 200, { ok: true, skill, reloadedSessions });
			} catch (err) {
				if (err instanceof SkillError) throw new HttpError(err.status, err.message);
				throw err;
			}
			return;
		}
		throw new HttpError(405, "method not allowed");
	}

	if (seg1 === "kb") {
		try {
			await handleKbRoutes(ctx);
		} catch (err) {
			if (err instanceof kb.KbError) throw new HttpError(err.status, err.message);
			throw err;
		}
		return;
	}

	if (seg1 === "sessions") {
		if (!id) {
			if (method === "POST") {
				const body = await readBody(req);
				const name = typeof body.name === "string" && body.name ? body.name : undefined;
				const session = await manager.createSession(name);
				sendJson(res, 201, {
					id: session.sessionId,
					name: session.sessionName,
					file: session.sessionFile,
					...sessionMeta(session),
				});
				return;
			}
		if (method === "GET") {
			const sessions = await manager.listSessions();
			for (const s of sessions) {
				// The injected KB context block lives in the persisted user
				// message; keep it out of the session list preview.
				if (typeof s.firstMessage === "string" && s.firstMessage.includes(kb.KB_CONTEXT_START)) {
					s.firstMessage = kb.stripKbContext(s.firstMessage);
				}
			}
			sendJson(res, 200, { sessions });
			return;
		}
		throw new HttpError(405, "method not allowed");
	}

		if (sub) {
			const session = await requireSession(id);
			switch (sub) {
				case "prompt":
					if (method !== "POST") throw new HttpError(405, "method not allowed");
					await handlePrompt(ctx, session);
					return;
				case "messages":
					if (method !== "GET") throw new HttpError(405, "method not allowed");
					sendJson(res, 200, {
						sessionId: session.sessionId,
						...sessionMeta(session),
						isIdle: session.isIdle,
						messages: session.messages.map(simplifyMessage),
					});
					return;
				case "stats":
					if (method !== "GET") throw new HttpError(405, "method not allowed");
					sendJson(res, 200, session.getSessionStats());
					return;
				case "model": {
					if (method !== "POST") throw new HttpError(405, "method not allowed");
					const body = await readBody(req);
					if (body.action === "cycle") {
						const result = await session.cycleModel();
						sendJson(res, 200, {
							ok: true,
							model: result ? `${result.model.provider}/${result.model.id}` : null,
							thinkingLevel: session.thinkingLevel,
							availableThinkingLevels: session.getAvailableThinkingLevels(),
						});
						return;
					}
					const provider = body.provider;
					const modelId = body.id ?? body.model;
					if (typeof provider !== "string" || typeof modelId !== "string") {
						throw new HttpError(400, "fields 'provider' and 'id' are required (or action:'cycle')");
					}
					const model = manager.resolveModel(provider, modelId);
					if (!model) notFound(`model ${provider}/${modelId}`);
					try {
						await manager.switchModelEverywhere(session, model);
					} catch (err) {
						throw new HttpError(400, err instanceof Error ? err.message : String(err));
					}
					if (typeof body.thinkingLevel === "string") {
						session.setThinkingLevel(body.thinkingLevel as never);
					}
					sendJson(res, 200, { ok: true, ...sessionMeta(session) });
					return;
				}
				case "thinking": {
					if (method !== "POST") throw new HttpError(405, "method not allowed");
					const body = await readBody(req);
					if (typeof body.level !== "string") throw new HttpError(400, "field 'level' is required");
					const levels = session.getAvailableThinkingLevels() as string[];
					if (!levels.includes(body.level)) {
						throw new HttpError(400, `unsupported level '${body.level}'; available: ${levels.join(", ") || "none"}`);
					}
					session.setThinkingLevel(body.level as never);
					sendJson(res, 200, { ok: true, ...sessionMeta(session) });
					return;
				}
				case "compact": {
					if (method !== "POST") throw new HttpError(405, "method not allowed");
					const body = await readBody(req);
					const result = await session.compact(typeof body.instructions === "string" ? body.instructions : undefined);
					sendJson(res, 200, { ok: true, result });
					return;
				}
				case "abort": {
					if (method !== "POST") throw new HttpError(405, "method not allowed");
					await session.abort();
					sendJson(res, 200, { ok: true });
					return;
				}
				case "rename": {
					if (method !== "POST" && method !== "PATCH") throw new HttpError(405, "method not allowed");
					const body = await readBody(req);
					const name = typeof body.name === "string" ? body.name.trim() : "";
					if (!name) throw new HttpError(400, "field 'name' (string) is required");
					const renamed = await manager.renameSession(id, name);
					if (!renamed) notFound("session");
					sendJson(res, 200, { ok: true, id: renamed.sessionId, name: renamed.sessionName });
					return;
				}
				default:
					notFound("endpoint");
			}
		}

		if (method === "DELETE") {
			const ok = await manager.deleteSession(id);
			sendJson(res, ok ? 200 : 404, ok ? { ok: true, deleted: id } : { error: "session not found" });
			return;
		}
		if (method === "GET") {
			const session = await requireSession(id);
			sendJson(res, 200, {
				id: session.sessionId,
				name: session.sessionName,
				file: session.sessionFile,
				...sessionMeta(session),
				isIdle: session.isIdle,
				tools: session.getActiveToolNames(),
			});
			return;
		}
		throw new HttpError(405, "method not allowed");
	}

	notFound("endpoint");
}

// ---------------------------------------------------------------------------
// server bootstrap

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", "http://localhost");
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");
	if (req.method === "OPTIONS") {
		res.writeHead(204);
		res.end();
		return;
	}
	try {
		await route({ req, res, parts: url.pathname.split("/").filter(Boolean), query: url.searchParams });
	} catch (err) {
		const status = err instanceof HttpError ? err.status : 500;
		if (!res.headersSent) {
			sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
		} else {
			res.end();
		}
		if (status >= 500) console.error("[server]", err);
	}
});

await manager.init();

// Fire-and-forget RAG auto-start (autoStart: config). The service warms up
// (40-60s) while the HTTP server is already serving /api/kb status probes.
if (CONFIG.rag.autoStart) {
	void kb.ensureService().catch((err) => console.error("[kb] auto-start failed:", err));
}

server.listen(CONFIG.port, CONFIG.host, () => {
	console.log(`pi-agent-server listening on http://${CONFIG.host}:${CONFIG.port}`);
	console.log(`  workspace : ${CONFIG.workspaceDir}`);
	console.log(`  sessions  : ${CONFIG.sessionDir}`);
	console.log(`  providers : config/providers.json (edit + auto hot-reload via /api/providers)`);
	console.log(`  project   : ${PROJECT_ROOT}`);
});

process.on("SIGINT", () => {
	manager.disposeAll();
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 2000).unref();
});
process.on("SIGTERM", () => {
	manager.disposeAll();
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 2000).unref();
});
