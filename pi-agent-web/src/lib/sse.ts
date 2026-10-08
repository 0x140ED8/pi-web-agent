import { ApiError, apiUrl } from "./api";

export interface SseEvent {
	event: string;
	data: unknown;
}

export interface StreamSseOptions {
	signal?: AbortSignal;
	onEvent: (ev: SseEvent) => void;
}

function dispatchFrame(frame: string, onEvent: (ev: SseEvent) => void): void {
	let event = "message";
	const dataLines: string[] = [];
	for (const rawLine of frame.split("\n")) {
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
		if (!line || line.startsWith(":")) continue;
		if (line.startsWith("event:")) event = line.slice(6).trim();
		else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
	}
	if (dataLines.length === 0) return;
	const raw = dataLines.join("\n");
	let data: unknown = raw;
	try {
		data = JSON.parse(raw);
	} catch {
		/* keep raw string */
	}
	onEvent({ event, data });
}

/**
 * POST a JSON body and consume the response as a Server-Sent Events stream.
 * The pi-agent-server prompt endpoint returns SSE on this POST response, so a
 * plain EventSource cannot be used. We parse `event:` / `data:` frames manually.
 *
 * Resolves when the stream ends (or the AbortController fires).
 */
export async function streamSse(path: string, body: unknown, opts: StreamSseOptions): Promise<void> {
	const res = await fetch(apiUrl(path), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "text/event-stream",
		},
		body: JSON.stringify(body),
		signal: opts.signal,
	});

	if (!res.ok || !res.body) {
		let message = `HTTP ${res.status}`;
		try {
			const text = await res.text();
			if (text) {
				try {
					const parsed = JSON.parse(text) as { error?: unknown };
					if (parsed?.error) message = String(parsed.error);
				} catch {
					message = text;
				}
			}
		} catch {
			/* ignore */
		}
		throw new ApiError(res.status, message);
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let sep = buffer.indexOf("\n\n");
		while (sep !== -1) {
			const frame = buffer.slice(0, sep);
			buffer = buffer.slice(sep + 2);
			if (frame.trim()) dispatchFrame(frame, opts.onEvent);
			sep = buffer.indexOf("\n\n");
		}
	}
	buffer += decoder.decode();
	if (buffer.trim()) dispatchFrame(buffer, opts.onEvent);
}
