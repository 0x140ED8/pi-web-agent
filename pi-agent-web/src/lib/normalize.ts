import type { ChatMessage, ContentBlock, KbHit, KbMessageContext } from "./types";

let counter = 0;

const KB_CONTEXT_RE = /<<<KB_CONTEXT>>>[\s\S]*?(?:<<<END_KB_CONTEXT>>>|$)/g;
const KB_CONTEXT_BLOCK_RE = /<<<KB_CONTEXT>>>([\s\S]*?)(?:<<<END_KB_CONTEXT>>>|$)/;
const KB_HEADER_RE = /^\[(\d+)\] 来源: (.*)$/;

/**
 * Strip the knowledge-base context block the server prepends to user
 * messages before retrieval-augmented prompts. Tolerates a missing END
 * marker (the messages API truncates long text).
 */
export function stripKbContext(text: string): string {
	if (!text.includes("<<<KB_CONTEXT>>>")) return text;
	return text.replace(KB_CONTEXT_RE, "").replace(/^[ \t\r\n]+/, "").replace(/[ \t\r\n]+$/, "");
}

/**
 * Re-parse a persisted <<<KB_CONTEXT>>> block (server-side formatContext
 * output) back into hit objects so historical sessions can show the raw
 * retrieval results behind an answer. The rewritten retrieval query is
 * restored too; score/chunk_id are not persisted in the block and stay empty.
 */
export function parseKbContextBlock(text: string): KbMessageContext | null {
	if (typeof text !== "string" || !text.includes("<<<KB_CONTEXT>>>")) return null;
	const match = KB_CONTEXT_BLOCK_RE.exec(text);
	if (!match) return null;
	const body = match[1] ?? "";
	// The rewritten query, when present, lives in the header area before the
	// first hit line ("[n] 来源: ...").
	const head = body.split(/^\[\d+\] 来源:/m)[0] ?? "";
	const queryMatch = /检索查询[:：]\s*(.+)/.exec(head);
	const lines = body.split(/\r?\n/);
	const hits: KbHit[] = [];
	let current: KbHit | null = null;
	for (const line of lines) {
		const header = KB_HEADER_RE.exec(line);
		if (header) {
			if (current) hits.push(current);
			const rest = header[2] ?? "";
			let source = rest;
			let page: number | null = null;
			let headingPath: string[] = [];
			const barIdx = rest.indexOf(" | ");
			if (barIdx !== -1) {
				source = rest.slice(0, barIdx);
				headingPath = rest
					.slice(barIdx + 3)
					.split(" > ")
					.map((s) => s.trim())
					.filter(Boolean);
			}
			const pageMatch = / 第(\d+)页$/.exec(source);
			if (pageMatch) {
				page = Number(pageMatch[1]);
				source = source.slice(0, pageMatch.index);
			}
			current = {
				chunk_id: "",
				text: "",
				score: 0,
				source: source.trim(),
				heading_path: headingPath,
				page,
			};
		} else if (current) {
			current.text += (current.text ? "\n" : "") + line;
		}
	}
	if (current) hits.push(current);
	for (const hit of hits) hit.text = hit.text.trim();
	const nameMatch = /「([^」]+)」/.exec(body);
	const nonEmpty = hits.filter((h) => h.text);
	if (!nonEmpty.length) return null;
	return {
		kbName: nameMatch ? nameMatch[1] : undefined,
		rewrittenQuery: queryMatch ? queryMatch[1].trim() : undefined,
		hits: nonEmpty,
	};
}

/**
 * Validate the raw `results` array of a live kb_context SSE event into hits.
 * Drops malformed entries instead of failing the whole event.
 */
export function parseKbHits(value: unknown): KbHit[] {
	if (!Array.isArray(value)) return [];
	const hits: KbHit[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== "object") continue;
		const h = raw as Record<string, unknown>;
		if (typeof h.text !== "string" || typeof h.source !== "string") continue;
		hits.push({
			chunk_id: typeof h.chunk_id === "string" ? h.chunk_id : "",
			text: h.text,
			score: typeof h.score === "number" ? h.score : 0,
			source: h.source,
			heading_path: Array.isArray(h.heading_path)
				? h.heading_path.filter((s): s is string => typeof s === "string" && s.length > 0)
				: [],
			page: typeof h.page === "number" ? h.page : null,
		});
	}
	return hits;
}

/** Index path shown in the results modal: [document/heading 1/heading 2/...]. */
export function kbIndexPath(hit: KbHit): string {
	return `[${[hit.source, ...hit.heading_path].filter(Boolean).join("/")}]`;
}

export function nextId(prefix = "m"): string {
	counter += 1;
	return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/**
 * Convert a raw pi message content (string or block array) into UI content
 * blocks. Pi stores tool calls as `{type:"toolCall", id, name, arguments}`;
 * the UI uses `{toolCallId, toolName, input}`.
 */
export function normalizeContent(content: unknown): ContentBlock[] {
	if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
	if (!Array.isArray(content)) return [];
	const blocks: ContentBlock[] = [];
	for (const raw of content) {
		if (typeof raw === "string") {
			if (raw) blocks.push({ type: "text", text: raw });
			continue;
		}
		if (!raw || typeof raw !== "object") continue;
		const b = raw as Record<string, unknown>;
		if (b.type === "text") {
			blocks.push({ type: "text", text: typeof b.text === "string" ? b.text : "" });
		} else if (b.type === "thinking" || b.type === "reasoning") {
			blocks.push({
				type: "thinking",
				thinking: String(b.thinking ?? b.text ?? b.reasoning ?? ""),
			});
		} else if (b.type === "toolCall") {
			blocks.push({
				type: "toolCall",
				toolCallId: String(b.id ?? b.toolCallId ?? nextId("tc")),
				toolName: String(b.name ?? b.toolName ?? "tool"),
				input: b.arguments ?? b.input ?? b.args ?? {},
			});
		}
	}
	return blocks;
}

export function toChatMessage(raw: unknown, index: number): ChatMessage | null {
	if (!raw || typeof raw !== "object") return null;
	const m = raw as Record<string, unknown>;
	const role = m.role;
	if (role !== "user" && role !== "assistant" && role !== "toolResult") return null;
	const content = normalizeContent(m.content);
	// User bubbles show the original text only; the injected KB context
	// block (<<<KB_CONTEXT>>>...<<<END_KB_CONTEXT>>>) stays in the JSONL
	// for the model but is hidden in the UI. It is re-parsed into
	// `kbContext` so the UI can show the raw retrieval results on demand.
	let kbContext: KbMessageContext | undefined;
	const visibleContent =
		role === "user"
			? content.map((b) => {
					if (b.type !== "text") return b;
					kbContext = kbContext ?? parseKbContextBlock(b.text) ?? undefined;
					return { ...b, text: stripKbContext(b.text) };
				})
			: content;
	return {
		id: typeof m.id === "string" ? m.id : nextId(`msg${index}`),
		role,
		content: visibleContent,
		kbContext,
		timestamp: typeof m.timestamp === "number" ? m.timestamp : undefined,
		model: typeof m.model === "string" ? m.model : undefined,
		provider: typeof m.provider === "string" ? m.provider : undefined,
		usage: (m.usage as ChatMessage["usage"]) ?? undefined,
		stopReason: typeof m.stopReason === "string" ? m.stopReason : undefined,
		errorMessage: typeof m.errorMessage === "string" ? m.errorMessage : undefined,
		toolCallId: typeof m.toolCallId === "string" ? m.toolCallId : undefined,
		isError: typeof m.isError === "boolean" ? m.isError : undefined,
	};
}

export function toChatMessages(raw: unknown[]): ChatMessage[] {
	const out: ChatMessage[] = [];
	raw.forEach((r, i) => {
		const m = toChatMessage(r, i);
		if (m) out.push(m);
	});
	return out;
}

export function contentToText(content: unknown): string {
	if (typeof content === "string") return content;
	return normalizeContent(content)
		.map((b) => (b.type === "text" ? b.text : b.type === "thinking" ? b.thinking : ""))
		.filter(Boolean)
		.join("\n");
}

/** Pretty-print a tool result payload for the collapsible result panel. */
export function toolResultText(result: unknown): string {
	if (result == null) return "";
	if (typeof result === "string") return result;
	if (typeof result === "object") {
		const r = result as Record<string, unknown>;
		if (typeof r.content !== "undefined") return contentToText(r.content);
		if (typeof r.text === "string") return r.text;
		if (typeof r.result === "string") return r.result;
	}
	try {
		return JSON.stringify(result, null, 2);
	} catch {
		return String(result);
	}
}

export function prettyJson(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

/**
 * One-line subject of a tool call: the file, command or pattern the tool acts
 * on. This is what makes a run readable while the card is collapsed.
 */
export function toolSubject(input: unknown): string {
	if (!input || typeof input !== "object") return "";
	const record = input as Record<string, unknown>;
	const keys = ["command", "file_path", "filePath", "path", "pattern", "query", "url", "prompt"];
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.replace(/\s+/g, " ").trim();
	}
	return "";
}
