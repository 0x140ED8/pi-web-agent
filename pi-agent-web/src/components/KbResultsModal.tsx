import { useI18n } from "../i18n";
import { kbIndexPath } from "../lib/normalize";
import type { KbMessageContext } from "../lib/types";
import { Modal } from "./Modal";

interface KbResultsModalProps {
	open: boolean;
	onClose: () => void;
	context: KbMessageContext | null;
}

/**
 * Raw knowledge-base retrieval results behind one assistant answer: each hit
 * with its index path [document/heading 1/heading 2/...], page, score and
 * original chunk text.
 */
export function KbResultsModal({ open, onClose, context }: KbResultsModalProps) {
	const { t } = useI18n();
	if (!context) return null;

	const meta: string[] = [];
	if (context.kbName) meta.push(t("chat.kb.kbName", { name: context.kbName }));
	if (context.rewrittenQuery) meta.push(t("chat.kb.rewrittenQuery", { query: context.rewrittenQuery }));
	if (typeof context.tookMs === "number") meta.push(`${context.tookMs}ms`);

	return (
		<Modal open={open} onClose={onClose} title={t("chat.kb.resultsTitle")} widthClass="max-w-3xl">
			<div className="flex flex-col gap-3">
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-dim">
					{meta.map((m) => (
						<span key={m}>{m}</span>
					))}
					<span className="flex-1" />
					<span>{t("chat.kb.hitCount", { n: context.hits.length })}</span>
				</div>
				{context.hits.map((hit, i) => (
					<div
						key={hit.chunk_id || `hit-${i}`}
						className="overflow-hidden rounded-[4px] border border-border bg-tool"
					>
						<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-border px-3 py-1.5">
							<span className="mr-1 font-mono text-[11px] text-dim">{i + 1}</span>
							<span className="min-w-0 flex-1 break-all font-mono text-[11px] text-accent">
								{kbIndexPath(hit)}
							</span>
							{hit.page != null && (
								<span className="font-mono text-[10px] text-dim">
									{t("chat.kb.page", { n: hit.page })}
								</span>
							)}
							{hit.score > 0 && (
								<span className="font-mono text-[10px] text-dim">{hit.score.toFixed(4)}</span>
							)}
						</div>
						<pre className="max-h-56 overflow-auto px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words text-muted">
							{hit.text}
						</pre>
					</div>
				))}
			</div>
		</Modal>
	);
}
