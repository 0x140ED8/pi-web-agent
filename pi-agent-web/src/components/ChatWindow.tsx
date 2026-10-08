import clsx from "clsx";
import { useEffect, useRef } from "react";
import { useI18n, type MessageKey } from "../i18n";
import type { ChatMessage, KbMessageContext } from "../lib/types";
import { useAgent } from "../state/agent";
import { CloseIcon, PlusIcon } from "./icons";
import { MessageView } from "./MessageView";
import { ToolCallCard } from "./ToolCallCard";

/** Map each assistant answer to the KB results of the user turn it replies to. */
function associateKbContexts(messages: ChatMessage[]) {
	const byAssistantId = new Map<string, KbMessageContext>();
	let pending: KbMessageContext | null = null;
	for (const m of messages) {
		if (m.role === "user") {
			pending = m.kbContext ?? null;
			continue;
		}
		if (m.role !== "assistant" || !pending) continue;
		const hasText = m.content.some((b) => b.type === "text" && b.text);
		if (hasText) {
			byAssistantId.set(m.id, pending);
			pending = null;
		}
	}
	return byAssistantId;
}

export function ChatWindow() {
	const { t } = useI18n();
	const {
		online,
		workspace,
		activeId,
		messages,
		toolResults,
		activeTools,
		isStreaming,
		isCompacting,
		error,
		clearError,
		newSession,
	} = useAgent();
	const scrollRef = useRef<HTMLDivElement>(null);
	const pinnedRef = useRef(true);
	const kbByAssistantId = associateKbContexts(messages);

	// Track whether the reader is at the bottom of the transcript.
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const onScroll = () => {
			pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, []);

	// Follow new content (streaming text, async diagrams, late web fonts)
	// as long as the reader has not scrolled away from the bottom.
	useEffect(() => {
		const el = scrollRef.current;
		const content = el?.firstElementChild;
		if (!el || !content || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			if (pinnedRef.current) el.scrollTop = el.scrollHeight;
		});
		observer.observe(content);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		pinnedRef.current = true;
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [activeId]);

	useEffect(() => {
		const el = scrollRef.current;
		if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
	}, [messages, activeTools, isStreaming]);

	const infoCard = (		<div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 rounded-[4px] border border-border bg-panel px-4 py-3 text-left">
			<span className="eyebrow text-right">{t("chat.workspace")}</span>
			<span className="truncate font-mono text-[11.5px] text-muted" title={workspace ?? undefined}>
				{workspace ?? "—"}
			</span>
			<span className="eyebrow text-right">{t("chat.server")}</span>
			<span className="flex items-center gap-1.5 font-mono text-[11.5px] text-muted">
				<span className={clsx("h-1.5 w-1.5 rounded-full", online ? "bg-ok" : "bg-red-400")} />
				127.0.0.1:8787 · {online ? t("chat.online") : t("chat.offline")}
			</span>
		</div>
	);

	const legend = (
		<div className="hero-3 flex flex-wrap items-center gap-x-6 gap-y-2 pt-1">
			<span className="flex items-center gap-2">
				<span className="legend-glyph" aria-hidden>
					@
				</span>
				<span className="text-[12px] text-muted">{t("chat.legend.files")}</span>
			</span>
			<span className="flex items-center gap-2">
				<span className="legend-glyph" aria-hidden>
					/
				</span>
				<span className="text-[12px] text-muted">{t("chat.legend.skills")}</span>
			</span>
			<span className="flex items-center gap-2">
				<span className="legend-glyph" aria-hidden>
					⇧↵
				</span>
				<span className="text-[12px] text-muted">{t("chat.legend.newline")}</span>
			</span>
		</div>
	);

	// The empty state is the ledger's opening page: letterhead first, then the
	// composer's real affordances as a legend, then the session facts.
	const hero = (titleKey: MessageKey, subtitleKey: MessageKey, showStart: boolean) => (
		<div className="mx-auto flex w-full max-w-[460px] flex-col items-start gap-5 py-24 text-left">
			<div className="hero-1 flex w-full items-center gap-2.5">
				<span className="pi-mark" aria-hidden>
					π
				</span>
				<span className="eyebrow">{t("chat.hero.eyebrow")}</span>
				<span className="h-px flex-1 bg-border" aria-hidden />
			</div>
			<div className="hero-2 flex flex-col gap-2">
				<h1 className="text-[25px] font-semibold leading-[1.3] tracking-[-0.02em]">{t(titleKey)}</h1>
				<p className="max-w-[44ch] text-[13.5px] leading-relaxed text-muted">{t(subtitleKey)}</p>
			</div>
			{showStart && (
				<button
					type="button"
					onClick={() => void newSession()}
					className="hero-2 flex items-center gap-1.5 rounded-[4px] bg-btn-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-contrast hover:bg-btn-accent-hover"
				>
					<PlusIcon size={14} />
					{t("chat.startSession")}
				</button>
			)}
			{legend}
			<div className="hero-4 w-full">{infoCard}</div>
		</div>
	);

	return (
		<div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
			<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto flex max-w-[820px] flex-col gap-5 px-4 py-6">
					{!activeId ? (
						hero("chat.noSession.title", "chat.noSession.subtitle", true)
					) : messages.length === 0 && activeTools.length === 0 ? (
						hero("chat.empty.title", "chat.empty.subtitle", false)
					) : (
						<>
							{messages.map((m) => (
								<MessageView
									key={m.id}
									message={m}
									toolResults={toolResults}
									kbContext={kbByAssistantId.get(m.id)}
								/>
							))}
							{activeTools.map((run) => (
								<ToolCallCard
									key={run.toolCallId}
									toolName={run.toolName}
									input={run.args}
									status={run.status}
									resultText={
										run.result == null
											? undefined
											: typeof run.result === "string"
												? run.result
												: JSON.stringify(run.result, null, 2)
									}
								/>
							))}
						</>
					)}
					{isCompacting && (
						<div className="flex items-center gap-2 font-mono text-[11px] text-dim">
							<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
							{t("topbar.compacting")}
						</div>
					)}
				</div>
			</div>

			{error && (
				<div className="border-t border-red-500/30 bg-red-500/10 px-4 py-2">
					<div className="mx-auto flex max-w-[820px] items-center gap-2 text-[13px] text-red-400">
						<span className="flex-1">{error === "chat.busy" ? t("chat.busy") : error}</span>
						<button type="button" onClick={clearError} className="hover:text-red-300">
							<CloseIcon size={14} />
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
