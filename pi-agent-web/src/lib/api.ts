import type {
	KbActivateResult,
	KbDocument,
	KbIngestJob,
	KbOverview,
	KbQueryResult,
	KbRefreshResult,
	KnowledgeBase,
	ModelInfo,
	ProviderConfig,
	ProviderInput,
	RagConfig,
	RagConfigUpdateResult,
	SessionInfo,
	SessionStats,
	SkillInfo,
	ThinkingLevel,
} from "./types";

const RAW_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? "").trim();
/** Optional origin prefix; empty means same-origin (Vite dev proxy handles /api). */
export const API_BASE = RAW_BASE.replace(/\/+$/, "");

export function apiUrl(path: string): string {
	return `${API_BASE}${path}`;
}

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(apiUrl(path), {
		...init,
		headers: {
			...(init?.body ? { "Content-Type": "application/json" } : {}),
			...init?.headers,
		},
	});
	const text = await res.text();
	let data: unknown = undefined;
	if (text) {
		try {
			data = JSON.parse(text);
		} catch {
			data = text;
		}
	}
	if (!res.ok) {
		const message =
			data && typeof data === "object" && "error" in data
				? String((data as { error: unknown }).error)
				: `HTTP ${res.status}`;
		throw new ApiError(res.status, message);
	}
	return data as T;
}

/* ------------------------------------------------------------------ health */

export function getHealth(): Promise<{ ok: boolean; uptime: number }> {
	return request("/api/health");
}

export function getServerInfo(): Promise<{
	name: string;
	piEmbedding?: string;
	workspace?: string;
	endpoints?: string[];
}> {
	return request("/api/");
}

/* ------------------------------------------------------------------ models */

export function listModels(): Promise<{ models: ModelInfo[] }> {
	return request("/api/models");
}

/* --------------------------------------------------------------- sessions */

export function listSessions(): Promise<{ sessions: SessionInfo[] }> {
	return request("/api/sessions");
}

export function createSession(name?: string): Promise<{
	id: string;
	name?: string;
	file?: string;
	model?: string | null;
	thinkingLevel?: ThinkingLevel;
	availableThinkingLevels?: ThinkingLevel[];
}> {
	return request("/api/sessions", {
		method: "POST",
		body: JSON.stringify(name ? { name } : {}),
	});
}

export function getSession(id: string): Promise<{
	id: string;
	name?: string;
	file?: string;
	model?: string | null;
	thinkingLevel?: ThinkingLevel;
	availableThinkingLevels?: ThinkingLevel[];
	isIdle: boolean;
	tools?: string[];
}> {
	return request(`/api/sessions/${encodeURIComponent(id)}`);
}

export function deleteSession(id: string): Promise<{ ok: boolean; closed: string }> {
	return request(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function renameSession(id: string, name: string): Promise<{ ok: boolean; id: string; name: string }> {
	return request(`/api/sessions/${encodeURIComponent(id)}/rename`, {
		method: "POST",
		body: JSON.stringify({ name }),
	});
}

export function getMessages(id: string): Promise<{
	sessionId: string;
	model: string | null;
	thinkingLevel: ThinkingLevel;
	availableThinkingLevels: ThinkingLevel[];
	isIdle: boolean;
	messages: unknown[];
}> {
	return request(`/api/sessions/${encodeURIComponent(id)}/messages`);
}

export function getStats(id: string): Promise<SessionStats> {
	return request(`/api/sessions/${encodeURIComponent(id)}/stats`);
}

/* ------------------------------------------------------------ session ops */

export function setModel(
	id: string,
	ref: { provider: string; id: string } | { action: "cycle" },
	thinkingLevel?: ThinkingLevel,
): Promise<{
	ok: boolean;
	model: string | null;
	thinkingLevel: ThinkingLevel;
	availableThinkingLevels: ThinkingLevel[];
}> {
	const body =
		"action" in ref
			? { action: "cycle" }
			: { provider: ref.provider, id: ref.id, ...(thinkingLevel ? { thinkingLevel } : {}) };
	return request(`/api/sessions/${encodeURIComponent(id)}/model`, {
		method: "POST",
		body: JSON.stringify(body),
	});
}

export function setThinking(
	id: string,
	level: ThinkingLevel,
): Promise<{ ok: boolean; thinkingLevel: ThinkingLevel; availableThinkingLevels: ThinkingLevel[] }> {
	return request(`/api/sessions/${encodeURIComponent(id)}/thinking`, {
		method: "POST",
		body: JSON.stringify({ level }),
	});
}

export function compactSession(id: string, instructions?: string): Promise<{ ok: boolean; result: unknown }> {
	return request(`/api/sessions/${encodeURIComponent(id)}/compact`, {
		method: "POST",
		body: JSON.stringify(instructions ? { instructions } : {}),
	});
}

export function abortSession(id: string): Promise<{ ok: boolean }> {
	return request(`/api/sessions/${encodeURIComponent(id)}/abort`, { method: "POST", body: "{}" });
}

/* -------------------------------------------------------- one-shot / name */

export function oneShotChat(input: {
	message: string;
	systemPrompt?: string;
	provider?: string;
	id?: string;
}): Promise<{ text: string; model?: string }> {
	return request("/api/chat", { method: "POST", body: JSON.stringify(input) });
}

/* ------------------------------------------------------------------ files */

export function listWorkspaceFiles(): Promise<{ workspace: string; files: string[]; truncated: boolean }> {
	return request("/api/files");
}

/* ----------------------------------------------------------------- skills */

export function listSkills(): Promise<{ skills: SkillInfo[] }> {
	return request("/api/skills");
}

export function setSkillDisabled(
	filePath: string,
	disableModelInvocation: boolean,
): Promise<{ ok: boolean; skill: SkillInfo; reloadedSessions: number }> {
	return request("/api/skills", {
		method: "PATCH",
		body: JSON.stringify({ filePath, disableModelInvocation }),
	});
}

/* -------------------------------------------------------------- providers */

export function listProviders(): Promise<{ providers: ProviderConfig[] }> {
	return request("/api/providers");
}

export function putProvider(id: string, config: ProviderInput): Promise<ProviderConfig> {
	return request(`/api/providers/${encodeURIComponent(id)}`, {
		method: "PUT",
		body: JSON.stringify(config),
	});
}

export function patchProvider(
	id: string,
	patch: Omit<Partial<ProviderInput>, "apiKey"> & { apiKey?: string | null },
): Promise<ProviderConfig> {
	return request(`/api/providers/${encodeURIComponent(id)}`, {
		method: "PATCH",
		body: JSON.stringify(patch),
	});
}

export function deleteProvider(id: string): Promise<{ ok: boolean; deleted: string }> {
	return request(`/api/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ------------------------------------------------------- knowledge bases */

export function getKbOverview(): Promise<KbOverview> {
	return request("/api/kb");
}

export function createKb(input: { name: string; description?: string }): Promise<KnowledgeBase> {
	return request("/api/kb", { method: "POST", body: JSON.stringify(input) });
}

export function updateKb(
	id: string,
	patch: { name?: string; description?: string },
): Promise<KnowledgeBase> {
	return request(`/api/kb/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function getKbConfig(): Promise<RagConfig & { paths?: Record<string, string> }> {
	return request("/api/kb/config");
}

export function updateKbConfig(config: RagConfig): Promise<RagConfigUpdateResult> {
	return request("/api/kb/config", { method: "POST", body: JSON.stringify(config) });
}

export function deleteKb(id: string): Promise<{ ok: boolean; removedDir: boolean }> {
	return request(`/api/kb/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function activateKb(id: string): Promise<KbActivateResult> {
	return request(`/api/kb/${encodeURIComponent(id)}/activate`, { method: "POST", body: "{}" });
}

export function listKbDocuments(id: string): Promise<{ documents: KbDocument[] }> {
	return request(`/api/kb/${encodeURIComponent(id)}/documents`);
}

export function uploadKbDocument(id: string, name: string, contentBase64: string): Promise<KbDocument> {
	return request(`/api/kb/${encodeURIComponent(id)}/documents`, {
		method: "POST",
		body: JSON.stringify({ name, contentBase64 }),
	});
}

export function deleteKbDocument(id: string, name: string): Promise<{ ok: boolean }> {
	return request(
		`/api/kb/${encodeURIComponent(id)}/documents/${encodeURIComponent(name)}`,
		{ method: "DELETE" },
	);
}

export function ingestKb(id: string): Promise<{ job_id: string; status: string; detail: string }> {
	return request(`/api/kb/${encodeURIComponent(id)}/ingest`, { method: "POST", body: "{}" });
}

export function refreshKb(id: string): Promise<KbRefreshResult> {
	return request(`/api/kb/${encodeURIComponent(id)}/refresh`, { method: "POST", body: "{}" });
}

export function getKbJob(jobId: string): Promise<KbIngestJob> {
	return request(`/api/kb/jobs/${encodeURIComponent(jobId)}`);
}

export function queryKb(input: {
	query: string;
	kbId?: string;
	rewrite?: boolean;
	topK?: number;
	rerank?: boolean;
}): Promise<KbQueryResult> {
	return request("/api/kb/query", { method: "POST", body: JSON.stringify(input) });
}

export function startKbService(): Promise<{ ok: boolean; service: KbOverview["service"] }> {
	return request("/api/kb/service/start", { method: "POST", body: "{}" });
}
