/**
 * Knowledge-base (RAG) integration for the external retrieval service
 * (D:\MyAPP\rag, FastAPI on :8100).
 *
 * Responsibilities:
 * - registry of knowledge bases (data/knowledge-bases/registry.json)
 * - HTTP client for the RAG service (health/config/retrieve/ingest/jobs)
 * - service lifecycle (auto-start via configured python, warmup polling)
 * - activation: sync a KB's paths into the service config
 * - document management on each KB's data_dir (ingest scans it directly)
 * - query pipeline: rewrite (one-shot LLM) -> retrieve -> context block
 * - global RAG config proxy (GET/POST /api/config passthrough, paths protected)
 *
 * The service serves exactly one KB at a time (its config.paths decides
 * which); switching KBs = POST /api/config with the KB's paths (triggers a
 * lazy component rebuild, first retrieval after that takes 10-30s).
 *
 * Retrieval/parsing parameters are GLOBAL: they live in the RAG service's
 * config.yaml and are edited via /api/kb/config — never per KB.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { CONFIG, PROJECT_ROOT } from "./config.js";

const RAG = CONFIG.rag;

export const KB_CONTEXT_START = "<<<KB_CONTEXT>>>";
export const KB_CONTEXT_END = "<<<END_KB_CONTEXT>>>";
/** Cap so a full injected user message stays under the 8000-char API truncation. */
const KB_CONTEXT_MAX_CHARS = 6000;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export class KbError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
		this.name = "KbError";
	}
}

/* ------------------------------------------------------------------ types */

export interface KbPaths {
	data_dir: string;
	index_dir: string;
	parsed_dir: string;
}

export interface KnowledgeBase {
	id: string;
	name: string;
	description: string;
	paths: KbPaths;
	/** true: directories live under data/knowledge-bases/<id>/ (deletable). */
	managed: boolean;
	createdAt: number;
}

export interface Registry {
	activeId: string | null;
	knowledgeBases: KnowledgeBase[];
}

export interface RagHealth {
	status: string;
	index_ready: boolean;
	num_chunks: number;
	embedder_loaded: boolean;
	reranker_loaded: boolean;
	ingest_running: boolean;
	uptime_sec: number;
}

export interface KbHit {
	chunk_id: string;
	text: string;
	score: number;
	source: string;
	heading_path: string[];
	page: number | null;
}

/** Full config object as returned by GET /api/config (section -> fields). */
export type RagConfigDto = Record<string, Record<string, unknown>>;

export interface RagConfigUpdateResult {
	message: string;
	applied: boolean;
	warnings: string[];
	backup: string;
}

/** Result of POST /api/refresh (dry-run update check). */
export interface RagRefreshResult {
	up_to_date: boolean;
	index_ready: boolean;
	data_files: number;
	cache_files: number;
	files_reused: number;
	files_added: string[];
	files_removed: string[];
	params_changed: boolean;
}

export const REWRITE_SYSTEM_PROMPT = [
	"你是检索查询改写器。",
	"把用户的对话消息改写成一句适合语义检索的独立查询：补全指代（如“它/这个问题”）、保留关键名词与型号、去掉寒暄与多余指令。",
	"只输出改写后的查询本身，不要解释、不要引号，不超过 60 个字。",
].join("");

/* -------------------------------------------------------- RAG HTTP client */

const HEALTH_TIMEOUT_MS = 2000;
const SHORT_TIMEOUT_MS = 10_000;
const CONFIG_TIMEOUT_MS = 30_000;
/** First retrieve after a component rebuild can take 10-30s (lazy model load). */
const QUERY_TIMEOUT_MS = 120_000;

async function ragRequest<T>(pathname: string, init: RequestInit = {}, timeoutMs = SHORT_TIMEOUT_MS): Promise<T> {
	const res = await fetch(`${RAG.baseUrl}${pathname}`, {
		...init,
		headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
		signal: AbortSignal.timeout(timeoutMs),
	});
	const text = await res.text();
	let body: unknown = undefined;
	if (text) {
		try {
			body = JSON.parse(text);
		} catch {
			body = text;
		}
	}
	if (!res.ok) {
		let message = `RAG 服务返回 HTTP ${res.status}`;
		if (body && typeof body === "object" && "error" in body) {
			const err = (body as { error: unknown }).error;
			if (err && typeof err === "object" && "message" in err) {
				message = String((err as { message: unknown }).message);
			} else {
				message = String(err);
			}
		}
		throw new KbError(res.status, message);
	}
	return body as T;
}

/** Health probe; resolves null when the service is unreachable/offline. */
export async function ragHealth(timeoutMs = HEALTH_TIMEOUT_MS): Promise<RagHealth | null> {
	try {
		return await ragRequest<RagHealth>("/api/health", { method: "GET" }, timeoutMs);
	} catch {
		return null;
	}
}

function ragGetConfig(): Promise<RagConfigDto> {
	return ragRequest<RagConfigDto>("/api/config", { method: "GET" });
}

function ragApplyConfig(config: RagConfigDto): Promise<RagConfigUpdateResult> {
	return ragRequest("/api/config", { method: "POST", body: JSON.stringify(config) }, CONFIG_TIMEOUT_MS);
}

/**
 * Global RAG config passthrough. Ensures the service is up, then returns its
 * live config (section -> fields, raw YAML structure).
 */
export async function getRagConfig(): Promise<RagConfigDto> {
	if (!(await ensureService())) {
		throw new KbError(503, "RAG 服务不在线（autoStart 未启用或启动失败）");
	}
	return ragGetConfig();
}

/**
 * Apply a global RAG config update. `paths` belongs to the active KB
 * (managed by ensureActive) and `server` is read-only (host/port changes
 * would break the proxy) — both are force-restored from the live config
 * before posting. The RAG API is a full replace, so the caller must send a
 * complete config; unknown/mistyped fields are rejected by the service.
 */
export async function updateRagConfig(body: Record<string, unknown>): Promise<RagConfigUpdateResult> {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new KbError(400, "请求体必须是配置对象");
	}
	for (const [section, value] of Object.entries(body)) {
		if (section === "paths" || section === "server") continue;
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new KbError(400, `配置段落 '${section}' 必须是对象`);
		}
	}
	if (!(await ensureService())) {
		throw new KbError(503, "RAG 服务不在线（autoStart 未启用或启动失败）");
	}
	const current = await ragGetConfig();
	const merged: RagConfigDto = {
		...(body as RagConfigDto),
		paths: current.paths,
		server: current.server,
	};
	return ragApplyConfig(merged);
}

function ragRetrieve(
	query: string,
	opts: { top_k?: number; rerank?: boolean },
): Promise<{ query: string; hits: KbHit[]; took_ms: number }> {
	return ragRequest(
		"/api/retrieve",
		{ method: "POST", body: JSON.stringify({ query, ...opts }) },
		QUERY_TIMEOUT_MS,
	);
}

function ragIngest(): Promise<{ job_id: string; status: string; detail: string }> {
	return ragRequest("/api/ingest", { method: "POST", body: "{}" });
}

function ragRefresh(): Promise<RagRefreshResult> {
	return ragRequest("/api/refresh", { method: "POST", body: "{}" });
}

function ragJob(jobId: string): Promise<Record<string, unknown>> {
	return ragRequest(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "GET" });
}

/* ------------------------------------------------------ service lifecycle */

const SERVICE_POLL_MS = 2000;
const SERVICE_START_TIMEOUT_MS = 120_000;

let startPromise: Promise<boolean> | null = null;

export function isRagStarting(): boolean {
	return startPromise !== null;
}

/** Probe health; if offline and autoStart, spawn the RAG service and wait for it. */
export async function ensureService(): Promise<boolean> {
	if (startPromise) return startPromise;
	if (await ragHealth()) return true;
	if (!RAG.autoStart) return false;
	return launchRagService();
}

/** Force-spawn the RAG service regardless of autoStart (manual start button). */
export function launchRagService(): Promise<boolean> {
	if (startPromise) return startPromise;
	startPromise = spawnAndWait().finally(() => {
		startPromise = null;
	});
	return startPromise;
}

async function spawnAndWait(): Promise<boolean> {
	let spawnError: string | null = null;
	try {
		const url = new URL(RAG.baseUrl);
		const host = url.hostname || "127.0.0.1";
		const port = url.port || "8100";
		const child = spawn(RAG.python, ["-X", "utf8", "main.py", "serve", "--host", host, "--port", port], {
			cwd: RAG.projectDir,
			env: { ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" },
			windowsHide: true,
			stdio: "ignore",
		});
		child.unref();
		child.on("error", (err) => {
			console.error("[kb] RAG service process error:", err.message);
		});
		console.log(
			`[kb] spawning RAG service: ${RAG.python} main.py serve --host ${host} --port ${port} (cwd ${RAG.projectDir})`,
		);
	} catch (err) {
		spawnError = err instanceof Error ? err.message : String(err);
		console.error("[kb] failed to spawn RAG service:", spawnError);
	}
	if (spawnError) return false;
	// Poll until health answers. uvicorn does not accept connections while the
	// startup warmup (index + embedder + reranker preload, 40-60s) is running.
	const deadline = Date.now() + SERVICE_START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, SERVICE_POLL_MS));
		if (await ragHealth()) return true;
	}
	console.error("[kb] RAG service did not become healthy in time");
	return false;
}

export interface KbServiceStatus {
	online: boolean;
	starting: boolean;
	health: RagHealth | null;
}

export async function getServiceStatus(): Promise<KbServiceStatus> {
	const health = await ragHealth();
	return { online: Boolean(health), starting: isRagStarting(), health };
}

/* -------------------------------------------------------------- registry */

const KB_ROOT = path.join(PROJECT_ROOT, "data", "knowledge-bases");
const REGISTRY_PATH = path.join(KB_ROOT, "registry.json");

let registryCache: Registry | null = null;
let registryPromise: Promise<Registry> | null = null;

export async function loadRegistry(): Promise<Registry> {
	if (registryCache) return registryCache;
	if (registryPromise) return registryPromise;
	registryPromise = (async () => {
		const loaded = readRegistryFile();
		const registry = loaded && loaded.knowledgeBases.length > 0 ? loaded : await bootstrapDefaultRegistry();
		registryCache = registry;
		return registry;
	})().finally(() => {
		registryPromise = null;
	});
	return registryPromise;
}

function readRegistryFile(): Registry | null {
	try {
		if (!fs.existsSync(REGISTRY_PATH)) return null;
		const parsed = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8")) as Partial<Registry>;
		const knowledgeBases: KnowledgeBase[] = Array.isArray(parsed.knowledgeBases)
			? parsed.knowledgeBases
					.map((kb) => stripLegacySettings(kb))
					.filter((kb): kb is KnowledgeBase => {
						if (isValidKb(kb)) return true;
						console.warn("[kb] dropping malformed registry entry:", kb);
						return false;
					})
			: [];
		let activeId = typeof parsed.activeId === "string" ? parsed.activeId : null;
		if (activeId && !knowledgeBases.some((kb) => kb.id === activeId)) {
			activeId = knowledgeBases[0]?.id ?? null;
		}
		return { activeId, knowledgeBases };
	} catch (err) {
		console.error("[kb] failed to read registry:", err);
		return null;
	}
}

/** Drop the pre-global-config per-KB `settings` object (now unused). */
function stripLegacySettings(value: unknown): unknown {
	if (!value || typeof value !== "object") return value;
	const { settings: _settings, ...rest } = value as Record<string, unknown>;
	return rest;
}

function isValidKb(value: unknown): value is KnowledgeBase {
	if (!value || typeof value !== "object") return false;
	const kb = value as Partial<KnowledgeBase>;
	return (
		typeof kb.id === "string" &&
		/^[a-z0-9][a-z0-9-]{0,63}$/.test(kb.id) &&
		typeof kb.name === "string" &&
		kb.name.length > 0 &&
		typeof kb.description === "string" &&
		isValidPaths(kb.paths) &&
		typeof kb.managed === "boolean" &&
		typeof kb.createdAt === "number"
	);
}

function isValidPaths(value: unknown): value is KbPaths {
	if (!value || typeof value !== "object") return false;
	const p = value as Partial<KbPaths>;
	return (
		typeof p.data_dir === "string" &&
		p.data_dir.length > 0 &&
		typeof p.index_dir === "string" &&
		p.index_dir.length > 0 &&
		typeof p.parsed_dir === "string" &&
		p.parsed_dir.length > 0
	);
}

function saveRegistry(registry: Registry): void {
	fs.mkdirSync(KB_ROOT, { recursive: true });
	const tmp = `${REGISTRY_PATH}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(registry, null, "\t"), "utf8");
	fs.renameSync(tmp, REGISTRY_PATH);
}

function kbDir(id: string): string {
	return path.join(KB_ROOT, id);
}

/**
 * First run: register the KB the RAG service is currently configured for.
 * Paths are resolved to absolute (the service resolves relatives against its
 * own CWD; this process must not resolve them against pi-agent-server's).
 * Prefers the live service config, falls back to parsing config.yaml.
 */
async function bootstrapDefaultRegistry(): Promise<Registry> {
	let paths: KbPaths | null = null;
	try {
		const cfg = await ragRequest<RagConfigDto>("/api/config", { method: "GET" }, 3000);
		paths = pathsFromConfig(cfg);
	} catch {
		paths = readRagConfigFile();
	}
	if (!paths) {
		paths = {
			data_dir: path.join(RAG.projectDir, "data"),
			index_dir: path.join(RAG.projectDir, "index"),
			parsed_dir: path.join(RAG.projectDir, "parsed"),
		};
	}
	const registry: Registry = {
		activeId: "default",
		knowledgeBases: [
			{
				id: "default",
				name: "默认知识库",
				description: "RAG 项目当前配置指向的知识库（外部目录，仅记录，不托管文件）",
				paths,
				managed: false,
				createdAt: Date.now(),
			},
		],
	};
	saveRegistry(registry);
	console.log(`[kb] registered default knowledge base (data: ${paths.data_dir})`);
	return registry;
}

function resolveRagPath(value: unknown): string | null {
	if (typeof value !== "string" || !value.trim()) return null;
	const p = value.trim();
	return path.isAbsolute(p) ? path.normalize(p) : path.resolve(RAG.projectDir, p);
}

function pathsFromConfig(cfg: RagConfigDto): KbPaths | null {
	const data = resolveRagPath(cfg.paths?.data_dir);
	const index = resolveRagPath(cfg.paths?.index_dir);
	const parsed = resolveRagPath(cfg.paths?.parsed_dir);
	if (!data || !index || !parsed) return null;
	return { data_dir: data, index_dir: index, parsed_dir: parsed };
}

/** Minimal reader for the flat two-level config.yaml paths (offline bootstrap). */
function readRagConfigFile(): KbPaths | null {
	try {
		const file = path.join(RAG.projectDir, "config.yaml");
		if (!fs.existsSync(file)) return null;
		const values = readYamlScalars(fs.readFileSync(file, "utf8"));
		const data = resolveRagPath(values["paths.data_dir"]);
		const index = resolveRagPath(values["paths.index_dir"]);
		const parsed = resolveRagPath(values["paths.parsed_dir"]);
		if (!data || !index || !parsed) return null;
		return { data_dir: data, index_dir: index, parsed_dir: parsed };
	} catch {
		return null;
	}
}

/** Extract `section.key: scalar` pairs from a flat YAML file (skips lists). */
function readYamlScalars(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	let section = "";
	for (const raw of text.split(/\r?\n/)) {
		if (/^\S/.test(raw)) {
			const m = /^([A-Za-z_][\w-]*):/.exec(raw);
			section = m ? m[1] : "";
			continue;
		}
		if (!section) continue;
		const m = /^\s+([A-Za-z_][\w-]*):\s*(.*?)\s*(?:#.*)?$/.exec(raw);
		if (m && m[2] !== "") {
			out[`${section}.${m[1]}`] = m[2].replace(/^['"]|['"]$/g, "");
		}
	}
	return out;
}

/* -------------------------------------------------------------------- CRUD */

export interface KbInput {
	name: string;
	description?: string;
}

function newKbId(): string {
	return `kb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

async function requireKb(id: string): Promise<KnowledgeBase> {
	const registry = await loadRegistry();
	const kb = registry.knowledgeBases.find((k) => k.id === id);
	if (!kb) throw new KbError(404, `知识库不存在: ${id}`);
	return kb;
}

export async function createKnowledgeBase(input: KbInput): Promise<KnowledgeBase> {
	const name = input.name.trim();
	if (!name || name.length > 64) throw new KbError(400, "知识库名称必须为 1-64 个字符");
	const id = newKbId();
	const dir = kbDir(id);
	const paths: KbPaths = {
		data_dir: path.join(dir, "data"),
		index_dir: path.join(dir, "index"),
		parsed_dir: path.join(dir, "parsed"),
	};
	for (const p of Object.values(paths)) fs.mkdirSync(p, { recursive: true });
	const kb: KnowledgeBase = {
		id,
		name,
		description: typeof input.description === "string" ? input.description.trim() : "",
		paths,
		managed: true,
		createdAt: Date.now(),
	};
	const registry = await loadRegistry();
	registry.knowledgeBases.push(kb);
	if (!registry.activeId) registry.activeId = id;
	saveRegistry(registry);
	return kb;
}

export async function updateKnowledgeBase(
	id: string,
	patch: { name?: string; description?: string },
): Promise<KnowledgeBase> {
	const registry = await loadRegistry();
	const kb = registry.knowledgeBases.find((k) => k.id === id);
	if (!kb) throw new KbError(404, `知识库不存在: ${id}`);
	if (patch.name !== undefined) {
		const name = patch.name.trim();
		if (!name || name.length > 64) throw new KbError(400, "知识库名称必须为 1-64 个字符");
		kb.name = name;
	}
	if (patch.description !== undefined) kb.description = String(patch.description).trim();
	saveRegistry(registry);
	return kb;
}

export async function deleteKnowledgeBase(id: string): Promise<{ ok: true; removedDir: boolean }> {
	const registry = await loadRegistry();
	const kb = registry.knowledgeBases.find((k) => k.id === id);
	if (!kb) throw new KbError(404, `知识库不存在: ${id}`);
	registry.knowledgeBases = registry.knowledgeBases.filter((k) => k.id !== id);
	if (registry.activeId === id) registry.activeId = registry.knowledgeBases[0]?.id ?? null;
	saveRegistry(registry);
	// Managed KBs own their directory; external ones only lose the registry
	// record — their files are never touched.
	let removedDir = false;
	if (kb.managed) {
		const dir = kbDir(id);
		try {
			fs.rmSync(dir, { recursive: true, force: true });
			removedDir = !fs.existsSync(dir);
		} catch (err) {
			console.error(`[kb] failed to remove ${dir}:`, err);
		}
	}
	return { ok: true, removedDir };
}

/* -------------------------------------------------------------- activation */

let activationChain: Promise<unknown> = Promise.resolve();

/**
 * Serialize activations (the RAG service serves one KB; concurrent config
 * posts would race). Applies the KB's paths to the service config when they
 * differ, and records it as the registry's active KB. Global parameters are
 * never touched here.
 * Returns the RAG service's warnings from the applied config change.
 */
export function ensureActive(id: string): Promise<string[]> {
	const run = activationChain.then(() => ensureActiveInternal(id));
	activationChain = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

function normRagPath(p: string): string {
	const resolved = path.isAbsolute(p) ? path.normalize(p) : path.resolve(RAG.projectDir, p);
	return resolved.toLowerCase();
}

async function ensureActiveInternal(id: string): Promise<string[]> {
	const registry = await loadRegistry();
	const kb = registry.knowledgeBases.find((k) => k.id === id);
	if (!kb) throw new KbError(404, `知识库不存在: ${id}`);

	if (!(await ensureService())) {
		throw new KbError(503, "RAG 服务不在线（autoStart 未启用或启动失败）");
	}

	const cfg = await ragGetConfig();
	const pathsMatch = (["data_dir", "index_dir", "parsed_dir"] as const).every(
		(key) => normRagPath(String(cfg.paths?.[key] ?? "")) === normRagPath(kb.paths[key]),
	);

	const warnings: string[] = [];
	if (!pathsMatch) {
		const merged: RagConfigDto = {
			...cfg,
			paths: {
				...cfg.paths,
				data_dir: kb.paths.data_dir,
				index_dir: kb.paths.index_dir,
				parsed_dir: kb.paths.parsed_dir,
			},
		};
		const result = await ragApplyConfig(merged);
		warnings.push(...(result.warnings ?? []));
	}

	if (registry.activeId !== id) {
		registry.activeId = id;
		saveRegistry(registry);
	}
	return warnings;
}

export async function ingestKnowledgeBase(id: string): Promise<{
	job_id: string;
	status: string;
	detail: string;
}> {
	await ensureActive(id);
	return ragIngest();
}

/** Dry-run update check for a KB (no parsing/embedding; read-only). */
export async function refreshKnowledgeBase(id: string): Promise<RagRefreshResult> {
	await ensureActive(id);
	return ragRefresh();
}

export function getJob(jobId: string): Promise<Record<string, unknown>> {
	if (!/^[a-zA-Z0-9_-]{1,64}$/.test(jobId)) throw new KbError(400, "invalid job id");
	return ragJob(jobId);
}

/* --------------------------------------------------------------- documents */

export interface KbDocument {
	name: string;
	size: number;
	modified: number;
}

function listDocumentsInDir(dir: string): KbDocument[] {
	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		const docs: KbDocument[] = [];
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			if (entry.name.includes(".uploading-")) continue;
			try {
				const st = fs.statSync(path.join(dir, entry.name));
				docs.push({ name: entry.name, size: st.size, modified: st.mtimeMs });
			} catch {
				/* raced away between readdir and stat */
			}
		}
		docs.sort((a, b) => a.name.localeCompare(b.name));
		return docs;
	} catch {
		return [];
	}
}

export async function listDocuments(id: string): Promise<KbDocument[]> {
	const kb = await requireKb(id);
	return listDocumentsInDir(kb.paths.data_dir);
}

/** Synchronous listing for embed-into-other-responses use (GET /api/kb). */
export function listDocumentsSync(dir: string): KbDocument[] {
	return listDocumentsInDir(dir);
}

function sanitizeDocName(name: unknown): string {
	if (typeof name !== "string") throw new KbError(400, "文档名无效");
	const trimmed = name.trim();
	if (!trimmed || trimmed.length > 200) throw new KbError(400, "文档名无效");
	if (trimmed.includes("/") || trimmed.includes("\\") || trimmed === "." || trimmed === "..") {
		throw new KbError(400, "文档名不能包含路径分隔符");
	}
	if (/[\x00-\x1f]/.test(trimmed)) throw new KbError(400, "文档名包含非法字符");
	return trimmed;
}

export async function writeDocument(id: string, name: unknown, contentBase64: unknown): Promise<KbDocument> {
	const kb = await requireKb(id);
	const safeName = sanitizeDocName(name);
	if (typeof contentBase64 !== "string" || !contentBase64) {
		throw new KbError(400, "字段 'contentBase64' (string) 是必需的");
	}
	const normalized = contentBase64.replace(/\s+/g, "");
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length === 0) {
		throw new KbError(400, "contentBase64 不是合法的 base64");
	}
	const buffer = Buffer.from(normalized, "base64");
	if (buffer.length === 0) throw new KbError(400, "文档内容为空");
	if (buffer.length > MAX_UPLOAD_BYTES) {
		throw new KbError(413, `文档过大（${buffer.length} 字节，上限 ${MAX_UPLOAD_BYTES}）`);
	}
	const dir = kb.paths.data_dir;
	fs.mkdirSync(dir, { recursive: true });
	const target = path.join(dir, safeName);
	const tmp = `${target}.uploading-${Date.now().toString(36)}`;
	fs.writeFileSync(tmp, buffer);
	fs.renameSync(tmp, target);
	return { name: safeName, size: buffer.length, modified: Date.now() };
}

export async function deleteDocument(id: string, name: unknown): Promise<void> {
	const kb = await requireKb(id);
	const safeName = sanitizeDocName(name);
	const target = path.join(kb.paths.data_dir, safeName);
	try {
		fs.rmSync(target, { force: true });
	} catch (err) {
		throw new KbError(500, `删除文档失败: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/* ------------------------------------------------------------------- query */

export interface KbQueryOptions {
	kbId?: string;
	rewrite?: boolean;
	topK?: number;
	rerank?: boolean;
	/** One-shot tool-less LLM call used for query rewriting (AgentManager.oneShot). */
	oneShot?: (message: string, opts: { systemPrompt?: string }) => Promise<{ text: string }>;
}

export interface KbQueryResult {
	kbId: string;
	kbName: string;
	query: string;
	rewrittenQuery: string;
	rewriteSkipped: boolean;
	hits: KbHit[];
	took_ms: number;
}

export async function queryKb(query: string, opts: KbQueryOptions = {}): Promise<KbQueryResult> {
	const registry = await loadRegistry();
	const id = opts.kbId ?? registry.activeId;
	if (!id) throw new KbError(400, "没有可用的知识库");
	const kb = registry.knowledgeBases.find((k) => k.id === id);
	if (!kb) throw new KbError(404, `知识库不存在: ${id}`);

	if (!(await ensureService())) {
		throw new KbError(503, "RAG 服务不在线");
	}
	await ensureActive(id);

	let rewritten = query;
	let rewriteSkipped = false;
	if (opts.rewrite !== false && opts.oneShot) {
		try {
			const res = await opts.oneShot(query, { systemPrompt: REWRITE_SYSTEM_PROMPT });
			const cleaned = cleanRewrittenQuery(res.text);
			if (cleaned) rewritten = cleaned;
			else rewriteSkipped = true;
		} catch (err) {
			console.error("[kb] query rewrite failed:", err);
			rewriteSkipped = true;
		}
	} else {
		rewriteSkipped = true;
	}

	// top_k / rerank defaults come from the global RAG config
	// (reranker.top_k; rerank on unless explicitly disabled per request).
	const retrieveOpts: { top_k?: number; rerank?: boolean } = {};
	if (typeof opts.topK === "number" && opts.topK > 0 && opts.topK <= 50) {
		retrieveOpts.top_k = Math.floor(opts.topK);
	}
	if (opts.rerank === false) retrieveOpts.rerank = false;

	const result = await ragRetrieve(rewritten, retrieveOpts);
	return {
		kbId: id,
		kbName: kb.name,
		query,
		rewrittenQuery: rewritten,
		rewriteSkipped,
		hits: Array.isArray(result.hits) ? result.hits : [],
		took_ms: typeof result.took_ms === "number" ? result.took_ms : 0,
	};
}

function cleanRewrittenQuery(text: string | undefined): string {
	if (!text) return "";
	let s = text.trim().split(/\r?\n/).find((line) => line.trim()) ?? "";
	s = s.trim();
	s = s.replace(/^(改写|查询|检索|query)\s*[:：]\s*/i, "");
	s = s.replace(/^["'“”‘’「」『』]+|["'“”‘’「」『』]+$/g, "");
	return s.slice(0, 300).trim();
}

/* ------------------------------------------------------- context injection */

/**
 * Render retrieved hits as the marked context block that is appended to the
 * user message. `rewrittenQuery` (the query-rewrite result actually used for
 * retrieval) is kept in the block so the web UI can still show it after a
 * session reload. Truncated at KB_CONTEXT_MAX_CHARS so the whole user message
 * (context + original text) stays under the 8000-char API truncation.
 */
export function formatContext(hits: KbHit[], kbName: string, rewrittenQuery?: string): string | null {
	if (!hits.length) return null;
	const blocks: string[] = [];
	let total = 0;
	for (const hit of hits) {
		const heading = Array.isArray(hit.heading_path)
			? hit.heading_path.filter((h) => typeof h === "string" && h).join(" > ")
			: "";
		const page = typeof hit.page === "number" ? ` 第${hit.page}页` : "";
		const header = `[${blocks.length + 1}] 来源: ${hit.source ?? ""}${page}${heading ? ` | ${heading}` : ""}`;
		const text = (hit.text ?? "").trim();
		const block = `${header}\n${text}`;
		if (blocks.length > 0 && total + block.length > KB_CONTEXT_MAX_CHARS) break;
		blocks.push(block);
		total += block.length;
	}
	if (!blocks.length) return null;
	const lines = [
		KB_CONTEXT_START,
		`以下是知识库「${kbName}」检索到的相关资料（共 ${blocks.length} 段）。回答时优先依据这些资料，并用 [n] 标注来源编号；资料不足以回答时再补充说明。`,
	];
	const query = typeof rewrittenQuery === "string" ? rewrittenQuery.trim() : "";
	if (query) lines.push(`检索查询: ${query}`);
	lines.push(...blocks.map((block) => `${block}\n`), KB_CONTEXT_END);
	return lines.join("\n");
}

const KB_CONTEXT_RE = /<<<KB_CONTEXT>>>[\s\S]*?(?:<<<END_KB_CONTEXT>>>|$)/g;

/**
 * Remove the injected context block from a user message. Tolerates a missing
 * END marker (the messages API truncates text at 8000 chars).
 */
export function stripKbContext(text: string): string {
	if (!text.includes(KB_CONTEXT_START)) return text;
	const stripped = text.replace(KB_CONTEXT_RE, "");
	return stripped.replace(/^[ \t\r\n]+/, "").replace(/[ \t\r\n]+$/, "");
}

