import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import * as api from "../lib/api";
import { contentToText, nextId, parseKbHits, toChatMessage, toChatMessages } from "../lib/normalize";
import { cleanSessionName, loadSettings, saveSettings, type AppSettings } from "../lib/settings";
import { streamSse } from "../lib/sse";
import type {
	ChatMessage,
	ContentBlock,
	KnowledgeBase,
	KbMessageContext,
	KbServiceStatus,
	ModelInfo,
	SessionInfo,
	SessionStats,
	ThinkingLevel,
	ToolRun,
} from "../lib/types";

interface SessionMeta {
	model: string | null;
	thinkingLevel: ThinkingLevel;
	availableThinkingLevels: ThinkingLevel[];
}

/** Result of the per-prompt knowledge-base retrieval (kb_context SSE event). */
export interface KbContextInfo {
	status: "ok" | "empty" | "error" | string;
	kbId?: string;
	kbName?: string;
	rewrittenQuery?: string;
	hits?: number;
	tookMs?: number;
	message?: string;
}

/** Client-side timing key: one retrieval per (session, user text). */
function kbTimingKey(sessionId: string, userText: string): string {
	return `${sessionId}\n${userText}`;
}

const KB_TIMING_STORAGE = "pi-agent-web:kb-timings";
const KB_TIMING_LIMIT = 200;

/** Restore client-measured KB round trips so they survive page reloads. */
function loadKbTimings(): Map<string, number> {
	const out = new Map<string, number>();
	try {
		const raw = localStorage.getItem(KB_TIMING_STORAGE);
		if (!raw) return out;
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value === "number" && Number.isFinite(value)) out.set(key, value);
		}
	} catch {
		/* ignore */
	}
	return out;
}

function saveKbTimings(timings: Map<string, number>): void {
	try {
		const keep = [...timings.entries()].slice(-KB_TIMING_LIMIT);
		localStorage.setItem(KB_TIMING_STORAGE, JSON.stringify(Object.fromEntries(keep)));
	} catch {
		/* ignore */
	}
}

interface AgentContextValue {
	online: boolean;
	workspace: string | null;
	sessions: SessionInfo[];
	activeId: string | null;
	activeSession: SessionInfo | undefined;
	messages: ChatMessage[];
	toolResults: Record<string, { text: string; isError: boolean }>;
	activeTools: ToolRun[];
	isStreaming: boolean;
	isCompacting: boolean;
	error: string | null;
	models: ModelInfo[];
	meta: SessionMeta;
	stats: SessionStats | null;
	settings: AppSettings;
	kbs: KnowledgeBase[];
	kbService: KbServiceStatus | null;
	kbActiveId: string | null;
	kbNotice: KbContextInfo | null;
	refreshSessions: () => Promise<void>;
	refreshModels: () => Promise<void>;
	refreshKbs: () => Promise<void>;
	selectSession: (id: string) => Promise<void>;
	newSession: () => Promise<void>;
	removeSession: (id: string) => Promise<void>;
	renameSession: (id: string, name: string) => Promise<void>;
	sendMessage: (text: string) => Promise<void>;
	stop: () => Promise<void>;
	switchModel: (provider: string, id: string) => Promise<void>;
	cycleModel: () => Promise<void>;
	setThinking: (level: ThinkingLevel) => Promise<void>;
	compact: (instructions?: string) => Promise<void>;
	clearError: () => void;
	updateSettings: (patch: Partial<AppSettings>) => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

function applyDelta(msg: ChatMessage, type: string, delta: string): ChatMessage {
	const kind: "text" | "thinking" | null = type.startsWith("thinking")
		? "thinking"
		: type.startsWith("text")
			? "text"
			: null;
	if (!kind) return msg;
	const content = msg.content.slice();
	const last = content[content.length - 1];
	if (last && last.type === kind) {
		if (kind === "text" && last.type === "text") {
			content[content.length - 1] = { type: "text", text: last.text + delta };
		} else if (kind === "thinking" && last.type === "thinking") {
			content[content.length - 1] = { type: "thinking", thinking: last.thinking + delta };
		}
	} else {
		const block: ContentBlock =
			kind === "text" ? { type: "text", text: delta } : { type: "thinking", thinking: delta };
		content.push(block);
	}
	return { ...msg, content };
}

function isAbortError(err: unknown): boolean {
	return err instanceof DOMException && err.name === "AbortError";
}

export function AgentProvider({ children }: { children: ReactNode }) {
	const [online, setOnline] = useState(false);
	const [workspace, setWorkspace] = useState<string | null>(null);
	const [sessions, setSessions] = useState<SessionInfo[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [activeTools, setActiveTools] = useState<ToolRun[]>([]);
	const [isStreaming, setIsStreaming] = useState(false);
	const [isCompacting, setIsCompacting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [models, setModels] = useState<ModelInfo[]>([]);
	const [meta, setMeta] = useState<SessionMeta>({
		model: null,
		thinkingLevel: "off",
		availableThinkingLevels: [],
	});
	const [stats, setStats] = useState<SessionStats | null>(null);
	const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
	const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
	const [kbService, setKbService] = useState<KbServiceStatus | null>(null);
	const [kbActiveId, setKbActiveId] = useState<string | null>(null);
	const [kbNotice, setKbNotice] = useState<KbContextInfo | null>(null);

	const activeIdRef = useRef<string | null>(null);
	const streamingRef = useRef(false);
	const streamMsgIdRef = useRef<string | null>(null);
	/** Optimistic user message of the in-flight run; receives live kb_context results. */
	const streamUserIdRef = useRef<string | null>(null);
	/** Session/user text of the in-flight run, used to key client-side KB timings. */
	const streamSessionRef = useRef<string | null>(null);
	const streamUserTextRef = useRef<string>("");
	/** performance.now() when the prompt was dispatched; null when KB was not used. */
	const kbStartRef = useRef<number | null>(null);
	/** Client-measured KB round trips (persisted), re-attached after reloadMessages re-parses history. */
	const [kbTimings] = useState<Map<string, number>>(loadKbTimings);
	const abortRef = useRef<AbortController | null>(null);
	const runCounterRef = useRef(0);

	useEffect(() => {
		activeIdRef.current = activeId;
	}, [activeId]);
	useEffect(() => {
		streamingRef.current = isStreaming;
	}, [isStreaming]);

	/* ------------------------------------------------------------ loaders */

	const refreshSessions = useCallback(async () => {
		try {
			const res = await api.listSessions();
			setSessions(res.sessions);
			setOnline(true);
		} catch {
			setOnline(false);
		}
	}, []);

	const refreshModels = useCallback(async () => {
		try {
			const res = await api.listModels();
			setModels(res.models);
		} catch {
			/* keep previous */
		}
	}, []);

	/** Load the knowledge-base overview (service status + registry). */
	const refreshKbs = useCallback(async () => {
		try {
			const res = await api.getKbOverview();
			setKbs(res.knowledgeBases ?? []);
			setKbService(res.service ?? null);
			setKbActiveId(res.activeId ?? null);
		} catch {
			/* server offline or older build — leave previous state */
		}
	}, []);

	const refreshStats = useCallback(async (sessionId: string) => {
		try {
			const s = await api.getStats(sessionId);
			if (activeIdRef.current === sessionId) setStats(s);
		} catch {
			/* ignore */
		}
	}, []);

	const reloadMessages = useCallback(async (sessionId: string) => {
		try {
			const res = await api.getMessages(sessionId);
			if (activeIdRef.current !== sessionId) return;
			// History re-parses the KB block (no timing in it), so re-attach the
			// client-measured round trip recorded for this session and user text.
			setMessages(
				toChatMessages(res.messages).map((m) => {
					if (m.role !== "user" || !m.kbContext || m.kbContext.elapsedMs != null) return m;
					const elapsedMs = kbTimings.get(kbTimingKey(sessionId, contentToText(m.content)));
					if (elapsedMs == null) return m;
					return { ...m, kbContext: { ...m.kbContext, elapsedMs } };
				}),
			);
			setMeta({
				model: res.model,
				thinkingLevel: res.thinkingLevel,
				availableThinkingLevels: res.availableThinkingLevels ?? [],
			});
		} catch {
			/* ignore */
		}
	}, []);

	useEffect(() => {
		void (async () => {
			try {
				await api.getHealth();
				setOnline(true);
			} catch {
				setOnline(false);
			}
			try {
				const info = await api.getServerInfo();
				if (typeof info.workspace === "string" && info.workspace) setWorkspace(info.workspace);
			} catch {
				/* workspace is informational only */
			}
		await Promise.all([refreshSessions(), refreshModels(), refreshKbs()]);
	})();
}, [refreshSessions, refreshModels, refreshKbs]);

	useEffect(() => {
		const timer = window.setInterval(() => {
			void refreshSessions();
		}, 6000);
		return () => window.clearInterval(timer);
	}, [refreshSessions]);

	/* --------------------------------------------------------- selection */

	const selectSession = useCallback(
		async (id: string) => {
			abortRef.current?.abort();
			activeIdRef.current = id;
			setActiveId(id);
			setMessages([]);
			setActiveTools([]);
			setStats(null);
			setError(null);
			setIsStreaming(false);
			streamingRef.current = false;
			await reloadMessages(id);
			await refreshStats(id);
		},
		[reloadMessages, refreshStats],
	);

	const newSession = useCallback(async () => {
		try {
			const created = await api.createSession();
			await refreshSessions();
			await selectSession(created.id);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, [refreshSessions, selectSession]);

	const removeSession = useCallback(
		async (id: string) => {
			if (activeIdRef.current === id) abortRef.current?.abort();
			try {
				await api.deleteSession(id);
			} catch {
				/* ignore */
			}
			await refreshSessions();
			if (activeIdRef.current === id) {
				activeIdRef.current = null;
				setActiveId(null);
				setMessages([]);
				setActiveTools([]);
				setStats(null);
			}
		},
		[refreshSessions],
	);

	const renameSession = useCallback(
		async (id: string, name: string) => {
			const trimmed = name.trim();
			if (!trimmed) return;
			try {
				await api.renameSession(id, trimmed);
				await refreshSessions();
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			}
		},
		[refreshSessions],
	);

	/* -------------------------------------------------------------- run */

	const handleEvent = useCallback((event: string, data: unknown) => {
		const payload = (data ?? {}) as Record<string, unknown>;
		switch (event) {
			case "message_start": {
				const m = toChatMessage(payload.message, 0);
				if (m && m.role === "assistant") {
					m.isStreaming = true;
					streamMsgIdRef.current = m.id;
					setMessages((prev) => [...prev, m]);
				}
				break;
			}
			case "message_update": {
				const ame = payload.assistantMessageEvent as Record<string, unknown> | undefined;
				const id = streamMsgIdRef.current;
				if (!ame || !id) break;
				const type = String(ame.type ?? "");
				const delta = typeof ame.delta === "string" ? ame.delta : "";
				if (!delta) break;
				setMessages((prev) => prev.map((m) => (m.id === id ? applyDelta(m, type, delta) : m)));
				break;
			}
			case "message_end": {
				const m = toChatMessage(payload.message, 0);
				if (!m || m.role === "user") break;
				if (m.role === "assistant") {
					const id = streamMsgIdRef.current;
					streamMsgIdRef.current = null;
					m.isStreaming = false;
					setMessages((prev) => {
						const idx = prev.findIndex((x) => x.id === id);
						if (idx === -1) return [...prev, m];
						const copy = prev.slice();
						copy[idx] = m;
						return copy;
					});
				} else {
					setMessages((prev) => [...prev, m]);
				}
				break;
			}
			case "tool_execution_start": {
				const run: ToolRun = {
					toolCallId: String(payload.toolCallId ?? nextId("tc")),
					toolName: String(payload.toolName ?? "tool"),
					args: payload.args,
					status: "running",
				};
				setActiveTools((prev) => [...prev, run]);
				break;
			}
			case "tool_execution_update": {
				setActiveTools((prev) =>
					prev.map((r) =>
						r.toolCallId === payload.toolCallId ? { ...r, result: payload.partialResult } : r,
					),
				);
				break;
			}
			case "tool_execution_end": {
				setActiveTools((prev) =>
					prev.map((r) =>
						r.toolCallId === payload.toolCallId
							? {
									...r,
									status: payload.isError ? "error" : "done",
									isError: Boolean(payload.isError),
									result: payload.result ?? r.result,
								}
							: r,
					),
				);
				break;
			}
			case "compaction_start":
			case "auto_compaction_start":
				setIsCompacting(true);
				break;
			case "compaction_end":
			case "auto_compaction_end":
				setIsCompacting(false);
				break;
		case "auto_retry_start":
			setError(null);
			break;
		case "kb_context": {
			const info: KbContextInfo = {
				status: String(payload.status ?? "unknown"),
				kbId: typeof payload.kbId === "string" ? payload.kbId : undefined,
				kbName: typeof payload.kbName === "string" ? payload.kbName : undefined,
				rewrittenQuery: typeof payload.rewrittenQuery === "string" ? payload.rewrittenQuery : undefined,
				hits: typeof payload.hits === "number" ? payload.hits : undefined,
				tookMs: typeof payload.tookMs === "number" ? payload.tookMs : undefined,
				message: typeof payload.message === "string" ? payload.message : undefined,
			};
			setKbNotice(info);
			const hits = parseKbHits(payload.results);
			// Raw hits are absent on older server builds still reporting only the
			// count — the round trip is complete either way, so time it regardless.
			const retrieved = info.status === "ok" && Math.max(info.hits ?? 0, hits.length) > 0;
			if (retrieved) {
				// Client-side total: prompt dispatch → kb_context arrival.
				const startedAt = kbStartRef.current;
				kbStartRef.current = null;
				const elapsedMs = startedAt != null ? Math.round(performance.now() - startedAt) : undefined;
				if (elapsedMs != null && streamSessionRef.current) {
					const key = kbTimingKey(streamSessionRef.current, streamUserTextRef.current);
					kbTimings.delete(key);
					kbTimings.set(key, elapsedMs);
					saveKbTimings(kbTimings);
				}
				const userId = streamUserIdRef.current;
				if (hits.length && userId) {
					const kbContext: KbMessageContext = {
						kbId: info.kbId,
						kbName: info.kbName,
						rewrittenQuery: info.rewrittenQuery,
						tookMs: info.tookMs,
						elapsedMs,
						hits,
					};
					setMessages((prev) =>
						prev.map((m) => (m.id === userId ? { ...m, kbContext } : m)),
					);
				}
			}
			break;
		}
		case "error":
			setError(String(payload.message ?? "error"));
			break;
			default:
				break;
		}
	}, []);

	const generateSessionName = useCallback(
		async (sessionId: string, firstText: string, currentSettings: AppSettings) => {
			try {
				const res = await api.oneShotChat({
					message: firstText,
					systemPrompt: currentSettings.namingPrompt,
				});
				const name = cleanSessionName(res.text);
				if (name) {
					await api.renameSession(sessionId, name);
					await refreshSessions();
				}
			} catch {
				/* naming is best-effort */
			}
		},
		[refreshSessions],
	);

	const sendMessage = useCallback(
		async (text: string) => {
			const sessionId = activeIdRef.current;
			const content = text.trim();
			if (!sessionId || !content) return;
			if (streamingRef.current) {
				setError("chat.busy");
				return;
			}

			const isFirstUserTurn = !messages.some((m) => m.role === "user");
			setError(null);
			setKbNotice(null);
			setIsStreaming(true);
			streamingRef.current = true;
			setActiveTools([]);
			runCounterRef.current += 1;
			const runId = runCounterRef.current;

			const userMsgId = nextId("u");
			streamUserIdRef.current = userMsgId;
			setMessages((prev) => [
				...prev,
				{
					id: userMsgId,
					role: "user",
					content: [{ type: "text", text: content }],
					timestamp: Date.now(),
				},
			]);

			if (isFirstUserTurn && settings.autoRename) {
				void generateSessionName(sessionId, content, settings);
			}

			const controller = new AbortController();
			abortRef.current = controller;

			// Knowledge-base injection is a server-side concern: it rewrites the
			// query, retrieves, and prepends a marked context block. Skipped
			// silently (kb_context event reports it) when off/failed.
			const kbId =
				settings.kbEnabled && (settings.kbId ?? kbActiveId) && (kbService?.online ?? false)
					? (settings.kbId ?? kbActiveId)
					: undefined;

			// Pure-frontend clock for the KB round trip: started when the prompt is
			// dispatched (retrieval begins server-side), frozen on kb_context.
			streamSessionRef.current = sessionId;
			streamUserTextRef.current = content;
			kbStartRef.current = kbId ? performance.now() : null;

			try {
				await streamSse(
					`/api/sessions/${encodeURIComponent(sessionId)}/prompt`,
					{ message: content, ...(kbId ? { knowledgeBaseId: kbId } : {}) },
					{
						signal: controller.signal,
						onEvent: ({ event, data }) => {
							if (runId !== runCounterRef.current) return;
							handleEvent(event, data);
						},
					},
				);
			} catch (err) {
				if (!isAbortError(err)) {
					setError(err instanceof Error ? err.message : String(err));
				}
			} finally {
				if (runId === runCounterRef.current) {
					streamMsgIdRef.current = null;
					streamUserIdRef.current = null;
					streamSessionRef.current = null;
					streamUserTextRef.current = "";
					kbStartRef.current = null;
					setIsStreaming(false);
					streamingRef.current = false;
					setActiveTools([]);
					await reloadMessages(sessionId);
					await refreshStats(sessionId);
					await refreshSessions();
				}
			}
		},
		[messages, settings, handleEvent, reloadMessages, refreshStats, refreshSessions, generateSessionName, kbActiveId, kbService],
	);

	const stop = useCallback(async () => {
		const sessionId = activeIdRef.current;
		if (!sessionId) return;
		try {
			await api.abortSession(sessionId);
		} catch {
			/* ignore */
		}
		abortRef.current?.abort();
	}, []);

	/* ------------------------------------------------------- session ops */

	const switchModel = useCallback(
		async (provider: string, id: string) => {
			const sessionId = activeIdRef.current;
			if (!sessionId) return;
			try {
				const res = await api.setModel(sessionId, { provider, id });
				setMeta((prev) => ({
					...prev,
					model: res.model,
					thinkingLevel: res.thinkingLevel,
					availableThinkingLevels: res.availableThinkingLevels ?? prev.availableThinkingLevels,
				}));
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			}
		},
		[],
	);

	const cycleModel = useCallback(async () => {
		const sessionId = activeIdRef.current;
		if (!sessionId) return;
		try {
			const res = await api.setModel(sessionId, { action: "cycle" });
			setMeta((prev) => ({
				...prev,
				model: res.model,
				thinkingLevel: res.thinkingLevel,
				availableThinkingLevels: res.availableThinkingLevels ?? prev.availableThinkingLevels,
			}));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	const setThinking = useCallback(async (level: ThinkingLevel) => {
		const sessionId = activeIdRef.current;
		if (!sessionId) return;
		try {
			const res = await api.setThinking(sessionId, level);
			setMeta((prev) => ({
				...prev,
				thinkingLevel: res.thinkingLevel,
				availableThinkingLevels: res.availableThinkingLevels ?? prev.availableThinkingLevels,
			}));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	const compact = useCallback(
		async (instructions?: string) => {
			const sessionId = activeIdRef.current;
			if (!sessionId) return;
			setIsCompacting(true);
			try {
				await api.compactSession(sessionId, instructions);
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				setIsCompacting(false);
				await reloadMessages(sessionId);
				await refreshStats(sessionId);
			}
		},
		[reloadMessages, refreshStats],
	);

	const updateSettings = useCallback((patch: Partial<AppSettings>) => {
		setSettings((prev) => {
			const next = { ...prev, ...patch };
			saveSettings(next);
			return next;
		});
	}, []);

	const clearError = useCallback(() => setError(null), []);

	const toolResults = useMemo(() => {
		const map: Record<string, { text: string; isError: boolean }> = {};
		for (const m of messages) {
			if (m.role === "toolResult" && m.toolCallId) {
				map[m.toolCallId] = { text: contentToText(m.content), isError: Boolean(m.isError) };
			}
		}
		return map;
	}, [messages]);

	const activeSession = useMemo(() => sessions.find((s) => s.id === activeId), [sessions, activeId]);

	const value = useMemo<AgentContextValue>(
		() => ({
			online,
			workspace,
			sessions,
			activeId,
			activeSession,
			messages,
			toolResults,
			activeTools,
			isStreaming,
			isCompacting,
			error,
			models,
			meta,
			stats,
			settings,
			kbs,
			kbService,
			kbActiveId,
			kbNotice,
			refreshSessions,
			refreshModels,
			refreshKbs,
			selectSession,
			newSession,
			removeSession,
			renameSession,
			sendMessage,
			stop,
			switchModel,
			cycleModel,
			setThinking,
			compact,
			clearError,
			updateSettings,
		}),
		[
			online,
			workspace,
			sessions,
			activeId,
			activeSession,
			messages,
			toolResults,
			activeTools,
			isStreaming,
			isCompacting,
			error,
			models,
			meta,
			stats,
			settings,
			kbs,
			kbService,
			kbActiveId,
			kbNotice,
			refreshSessions,
			refreshModels,
			refreshKbs,
			selectSession,
			newSession,
			removeSession,
			renameSession,
			sendMessage,
			stop,
			switchModel,
			cycleModel,
			setThinking,
			compact,
			clearError,
			updateSettings,
		],
	);

	return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgent(): AgentContextValue {
	const ctx = useContext(AgentContext);
	if (!ctx) throw new Error("useAgent must be used within AgentProvider");
	return ctx;
}
