import { useEffect } from "react";

interface ConfirmPopoverProps {
	anchor: DOMRect | null;
	message: string;
	confirmLabel: string;
	cancelLabel: string;
	onConfirm: () => void;
	onCancel: () => void;
}

const WIDTH = 208;

export function ConfirmPopover({
	anchor,
	message,
	confirmLabel,
	cancelLabel,
	onConfirm,
	onCancel,
}: ConfirmPopoverProps) {
	useEffect(() => {
		if (!anchor) return;
		const onScroll = () => onCancel();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onCancel();
		};
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", onScroll);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onScroll);
			window.removeEventListener("keydown", onKey);
		};
	}, [anchor, onCancel]);

	if (!anchor) return null;

	const left = Math.min(Math.max(8, anchor.right - WIDTH), window.innerWidth - WIDTH - 8);
	const bottom = window.innerHeight - anchor.top + 6;

	return (
		<>
			<div className="fixed inset-0 z-[55]" onClick={onCancel} aria-hidden />
			<div
				className="fade-in fixed z-[56] rounded-[6px] border border-border bg-bg p-2.5 shadow-[var(--shadow-pop)]"
				style={{ left, bottom, width: WIDTH }}
			>
				<div className="text-[12px] leading-snug text-muted">{message}</div>
				<div className="mt-2.5 flex justify-end gap-1.5">
					<button
						type="button"
						onClick={onCancel}
						className="rounded-[4px] border border-border px-2 py-1 text-[12px] text-muted hover:bg-btn-hover hover:text-text"
					>
						{cancelLabel}
					</button>
					<button
						type="button"
						onClick={onConfirm}
						className="rounded-[4px] bg-btn-danger px-2 py-1 text-[12px] font-medium text-white hover:bg-btn-danger-hover"
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</>
	);
}
