import clsx from "clsx";
import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { shortenPath } from "../lib/format";
import { prettyJson, toolResultText, toolSubject } from "../lib/normalize";
import { useAgent } from "../state/agent";
import { ChevronIcon } from "./icons";

interface ToolCallCardProps {
	toolName: string;
	input: unknown;
	status?: "running" | "done" | "error";
	resultText?: string | null;
	defaultOpen?: boolean;
}

export function ToolCallCard({ toolName, input, status = "done", resultText, defaultOpen }: ToolCallCardProps) {
	const { t } = useI18n();
	const { workspace } = useAgent();
	const [open, setOpen] = useState(Boolean(defaultOpen));
	const argsText = useMemo(() => {
		if (input == null || (typeof input === "object" && Object.keys(input as object).length === 0)) return "";
		return prettyJson(input);
	}, [input]);
	const subject = useMemo(() => toolSubject(input), [input]);
	const displaySubject = useMemo(() => shortenPath(subject, workspace), [subject, workspace]);

	const statusLabel =
		status === "running" ? t("chat.tool.running") : status === "error" ? t("chat.tool.error") : t("chat.tool.done");

	return (
		<div className="relative">
			<span className="run-node" data-status={status} aria-hidden />
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				className="flex w-full items-center gap-2 rounded-[4px] py-1.5 pl-6 pr-2 text-left hover:bg-btn-hover"
			>
				<span className="w-[72px] shrink-0 truncate font-mono text-[11.5px] font-medium text-text">
					{toolName}
				</span>
				{displaySubject ? (
					<span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted" title={subject}>
						{displaySubject}
					</span>
				) : (
					<span className="flex-1" />
				)}
				<span
					className={clsx(
						"shrink-0 font-mono text-[9.5px] uppercase tracking-[0.14em]",
						status === "error" ? "text-red-400" : status === "running" ? "text-accent" : "text-dim",
					)}
				>
					{statusLabel}
				</span>
				<ChevronIcon
					size={12}
					className={clsx("shrink-0 text-dim transition-transform", open && "rotate-90")}
				/>
			</button>
			{open && (
				<div className="pb-2 pl-6 pr-2">
					{argsText && (
						<div className="mb-2">
							<div className="eyebrow mb-1">{t("chat.tool.args")}</div>
							<pre className="max-h-64 overflow-auto rounded-[4px] border border-border bg-bg/60 p-2 font-mono text-[12px] leading-relaxed">
								{argsText}
							</pre>
						</div>
					)}
					<div>
						<div className="eyebrow mb-1">{t("chat.tool.result")}</div>
						{resultText ? (
							<pre className="max-h-80 overflow-auto rounded-[4px] border border-border bg-bg/60 p-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words">
								{resultText}
							</pre>
						) : (
							<div className="text-[12px] text-dim">
								{status === "running" ? t("chat.tool.running") : t("chat.tool.empty")}
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

export function toolResultSummary(result: unknown): string {
	return toolResultText(result);
}
