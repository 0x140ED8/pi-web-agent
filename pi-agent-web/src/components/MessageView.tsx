import clsx from "clsx";
import { useState } from "react";
import { useI18n } from "../i18n";
import { formatClock, formatDuration } from "../lib/format";
import { contentToText } from "../lib/normalize";
import type { ChatMessage, KbMessageContext } from "../lib/types";
import { CheckIcon, ChevronIcon, CopyIcon, DatabaseIcon } from "./icons";
import { KbResultsModal } from "./KbResultsModal";
import { MarkdownBody } from "./MarkdownBody";
import { ToolCallCard } from "./ToolCallCard";

interface MessageViewProps {
	message: ChatMessage;
	toolResults: Record<string, { text: string; isError: boolean }>;
	/** Retrieval results of the turn this assistant message answers (if KB was used). */
	kbContext?: KbMessageContext | null;
}

function ThinkingSection({ text }: { text: string }) {
	const { t } = useI18n();
	const [open, setOpen] = useState(false);
	return (
		<div className="my-1 overflow-hidden rounded-[4px] border border-border bg-tool">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-btn-hover"
			>
				<span className="font-mono text-[12px] leading-none text-accent">∴</span>
				<span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
					{t("chat.thinking")}
				</span>
				<span className="flex-1" />
				<ChevronIcon size={12} className={clsx("text-dim transition-transform", open && "rotate-90")} />
			</button>
			{open && (
				<pre className="max-h-72 overflow-auto border-t border-border px-2.5 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words text-muted">
					{text}
				</pre>
			)}
		</div>
	);
}

function KbResultsButton({ context }: { context: KbMessageContext }) {
	const { t } = useI18n();
	const [open, setOpen] = useState(false);
	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="my-1 flex items-center gap-2 rounded-[4px] border border-border bg-tool px-2.5 py-1.5 text-left hover:bg-btn-hover"
			>
				<DatabaseIcon size={13} className="shrink-0 text-accent" />
				<span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
					{t("chat.kb.showResults")}
				</span>
				{typeof context.elapsedMs === "number" && (
					<span className="font-mono text-[10px] text-accent">
						· {t("chat.kb.elapsed", { ms: formatDuration(context.elapsedMs) })}
					</span>
				)}
			</button>
			<KbResultsModal open={open} onClose={() => setOpen(false)} context={context} />
		</>
	);
}

export function MessageView({ message, toolResults, kbContext }: MessageViewProps) {
	const { t } = useI18n();
	const [copied, setCopied] = useState(false);

	if (message.role === "toolResult") return null;

	if (message.role === "user") {
		const text = contentToText(message.content);
		return (
			<div className="fade-in flex flex-col items-end gap-1">
				<div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
					<span>{t("chat.you")}</span>
					{message.timestamp ? <span>· {formatClock(message.timestamp)}</span> : null}
				</div>
				<div className="max-w-[85%] rounded-[4px] rounded-br-[2px] border border-border bg-user px-3.5 py-2.5 text-[14.5px] leading-[1.7] whitespace-pre-wrap break-words">
					{text}
				</div>
			</div>
		);
	}

	const texts = message.content.filter((b) => b.type === "text");
	const thinkings = message.content.filter((b) => b.type === "thinking");
	const toolCalls = message.content.filter((b) => b.type === "toolCall");
	const hasText = texts.some((b) => b.type === "text" && b.text);

	const handleCopy = () => {
		const text = contentToText(message.content);
		void navigator.clipboard?.writeText(text).then(() => {
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1500);
		});
	};

	return (
		<div className="group fade-in">
			<div className="flex items-center gap-2 pb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
				<span className="text-muted">{t("chat.assistant")}</span>
				{message.model && <span className="truncate normal-case tracking-normal">· {message.model}</span>}
				{message.timestamp ? <span>· {formatClock(message.timestamp)}</span> : null}
				<span className="flex-1" />
				<button
					type="button"
					onClick={handleCopy}
					title={copied ? t("chat.copied") : t("chat.copy")}
					className="text-dim opacity-0 transition-opacity group-hover:opacity-100 hover:text-text focus-visible:opacity-100"
				>
					{copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
				</button>
			</div>

			{kbContext && kbContext.hits.length > 0 && <KbResultsButton context={kbContext} />}

			{thinkings.map((b, i) => (
				<ThinkingSection key={`th-${i}`} text={b.type === "thinking" ? b.thinking : ""} />
			))}

			{toolCalls.length > 0 && (
				<div className="relative my-1">
					{toolCalls.length > 1 && (
						<span
							className="run-rail"
							data-live={message.isStreaming ? "true" : undefined}
							aria-hidden
						/>
					)}
					{toolCalls.map((b, i) => {
						if (b.type !== "toolCall") return null;
						const result = toolResults[b.toolCallId];
						return (
							<ToolCallCard
								key={`${b.toolCallId}-${i}`}
								toolName={b.toolName}
								input={b.input}
								status={result?.isError ? "error" : "done"}
								resultText={result?.text}
							/>
						);
					})}
				</div>
			)}

			{texts.map((b, i) =>
				b.type === "text" && b.text ? (
					<MarkdownBody key={`tx-${i}`} isStreaming={message.isStreaming}>
						{b.text}
					</MarkdownBody>
				) : null,
			)}

			{message.isStreaming && !hasText && (
				<div className="pt-0.5">
					<span className="stream-cursor" aria-hidden />
				</div>
			)}

			{message.errorMessage && (
				<div className="mt-1.5 rounded-[4px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-400">
					{message.errorMessage}
				</div>
			)}
		</div>
	);
}
