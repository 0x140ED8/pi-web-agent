export type Role = "user" | "assistant" | "toolResult";

export interface Usage {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	reasoning?: number;
	cost?: Record<string, unknown>;
}

export interface TextBlock {
	type: "text";
	text: string;
}

export interface ThinkingBlock {
	type: "thinking";
	thinking: string;
}

export interface ToolCallBlock {
	type: "toolCall";
	toolCallId: string;
	toolName: string;
	input: unknown;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolCallBlock;

export interface ChatMessage {
	id: string;
	role: Role;
	content: ContentBlock[];
	timestamp?: number;
	model?: string;
	provider?: string;
	usage?: Usage;
	stopReason?: string;
	errorMessage?: string;
	/** For role === "toolResult" */
	toolCallId?: string;
	isError?: boolean;
	isStreaming?: boolean;
	/** For role === "user": retrieval results re-parsed from the injected KB context block. */
	kbContext?: KbMessageContext;
}

export interface ToolRun {
	toolCallId: string;
	toolName: string;
	args: unknown;
	status: "running" | "done" | "error";
	result?: unknown;
	isError?: boolean;
}

/* ------------------------------------------------------------------ server */

export interface ModelInfo {
	provider: string;
	id: string;
	name?: string;
	reasoning?: boolean;
	input?: string[];
	contextWindow?: number;
	maxTokens?: number;
	available: boolean;
	source?: "providers.json" | "builtin" | string;
}

export interface SessionInfo {
	id: string;
	name?: string | null;
	file?: string;
	created?: number | string;
	modified?: number | string;
	messageCount?: number;
	firstMessage?: string;
	isOpen?: boolean;
}

export interface SessionStats {
	sessionId?: string;
	userMessages?: number;
	assistantMessages?: number;
	toolCalls?: number;
	toolResults?: number;
	totalMessages?: number;
	tokens?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		total?: number;
	};
	cost?: number;
	contextUsage?: {
		usedTokens?: number;
		maxTokens?: number;
		percentage?: number;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

export interface ProviderModelConfig {
	id: string;
	name?: string;
	api?: string;
	baseUrl?: string;
	reasoning?: boolean;
	input?: string[];
	contextWindow?: number;
	maxTokens?: number;
	[k: string]: unknown;
}

export interface ProviderConfig {
	id: string;
	name?: string;
	baseUrl: string;
	api?: string;
	authHeader?: boolean;
	headers?: Record<string, string>;
	compat?: Record<string, unknown>;
	models: ProviderModelConfig[];
	hasApiKey?: boolean;
	apiKeyMasked?: string;
	[k: string]: unknown;
}

export interface ProviderInput {
	name?: string;
	baseUrl: string;
	api?: string;
	apiKey?: string;
	authHeader?: boolean;
	headers?: Record<string, string>;
	compat?: Record<string, unknown>;
	models: ProviderModelConfig[];
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const THINKING_LEVELS: ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

export interface SkillInfo {
	name: string;
	description: string;
	filePath: string;
	baseDir?: string;
	source?: string;
	scope?: string;
	disableModelInvocation: boolean;
}

/* ----------------------------------------------------------- knowledge base */

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
	managed: boolean;
	createdAt: number;
	docCount?: number;
}

/* --------------------------------------------------- global RAG config (config.yaml) */

export interface RagHeadingPattern {
	regex: string;
	level: number;
}

export interface RagParserConfig {
	name: string;
	ocr: boolean;
	table_mode: string;
	skip_toc: boolean;
	device: string;
	heading_patterns: RagHeadingPattern[];
}

export interface RagChunkerConfig {
	name: string;
	chunk_size: number;
	chunk_overlap: number;
}

export interface RagEmbedderConfig {
	name: string;
	model_name: string;
	device: string;
	dtype: string;
	batch_size: number;
	compression_ratio: number;
}

export interface RagStoreConfig {
	name: string;
	distance_strategy: string;
}

export interface RagRetrieverConfig {
	name: string;
	dense_top_k: number;
	sparse_top_k: number;
	rrf_k: number;
}

export interface RagRerankerConfig {
	name: string;
	model_name: string;
	top_k: number;
	device: string;
}

export interface RagGeneratorConfig {
	name: string;
}

export interface RagServerConfig {
	host: string;
	port: number;
	cors_origins: string[];
	warmup: boolean;
}

/** Global RAG service config; `paths`/`server` are managed server-side (read-only here). */
export interface RagConfig {
	parser: RagParserConfig;
	chunker: RagChunkerConfig;
	embedder: RagEmbedderConfig;
	store: RagStoreConfig;
	retriever: RagRetrieverConfig;
	reranker: RagRerankerConfig;
	generator: RagGeneratorConfig;
	server: RagServerConfig;
}

export interface RagConfigUpdateResult {
	message: string;
	applied: boolean;
	warnings: string[];
	backup: string;
}

export interface KbServiceStatus {
	online: boolean;
	starting: boolean;
	health: {
		status: string;
		index_ready: boolean;
		num_chunks: number;
		embedder_loaded: boolean;
		reranker_loaded: boolean;
		ingest_running: boolean;
		uptime_sec: number;
	} | null;
}

export interface KbOverview {
	service: KbServiceStatus;
	activeId: string | null;
	knowledgeBases: KnowledgeBase[];
}

export interface KbDocument {
	name: string;
	size: number;
	modified: number;
}

export interface KbHit {
	chunk_id: string;
	text: string;
	score: number;
	source: string;
	heading_path: string[];
	page: number | null;
}

/** Raw KB retrieval results attached to an assistant answer (live SSE or re-parsed from history). */
export interface KbMessageContext {
	kbId?: string;
	kbName?: string;
	rewrittenQuery?: string;
	tookMs?: number;
	/** Client-measured ms from sending the prompt to the kb_context event (frontend only). */
	elapsedMs?: number;
	hits: KbHit[];
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

export interface KbIngestJob {
	job_id: string;
	status: "queued" | "running" | "done" | "failed" | string;
	stage: string;
	done: number;
	total: number;
	detail: string;
	result: {
		chunks?: number;
		files?: number;
		failed_files?: string[];
		took_sec?: number;
		files_reused?: number;
		files_added?: number;
		files_removed?: number;
		chunks_reused?: number;
		chunks_embedded?: number;
	} | null;
	error: string | null;
	logs: string[];
	[key: string]: unknown;
}

/** Result of POST /api/kb/:id/refresh (dry-run update check). */
export interface KbRefreshResult {
	up_to_date: boolean;
	index_ready: boolean;
	data_files: number;
	cache_files: number;
	files_reused: number;
	files_added: string[];
	files_removed: string[];
	params_changed: boolean;
}

export interface KbActivateResult {
	ok: boolean;
	activeId: string;
	warnings: string[];
}
