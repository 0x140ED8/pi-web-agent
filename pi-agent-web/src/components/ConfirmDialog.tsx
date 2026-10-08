import { useEffect } from "react";

interface ConfirmDialogProps {
	open: boolean;
	title: string;
	message: string;
	confirmLabel: string;
	cancelLabel: string;
	onConfirm: () => void;
	onCancel: () => void;
}

export function ConfirmDialog({
	open,
	title,
	message,
	confirmLabel,
	cancelLabel,
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") onCancel();
			if (e.key === "Enter") onConfirm();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [open, onConfirm, onCancel]);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
			<div className="absolute inset-0" onClick={onCancel} aria-hidden />
			<div className="fade-in relative z-10 w-full max-w-sm rounded-[6px] border border-border bg-bg p-4 shadow-[var(--shadow-pop)]">
				<div className="text-[13.5px] font-semibold tracking-tight">{title}</div>
				<div className="mt-2 whitespace-pre-line text-[12.5px] leading-relaxed text-muted">{message}</div>
				<div className="mt-4 flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						className="rounded-[4px] border border-border px-3 py-1.5 text-[12.5px] text-muted hover:bg-btn-hover hover:text-text"
					>
						{cancelLabel}
					</button>
					<button
						type="button"
						onClick={onConfirm}
						className="rounded-[4px] bg-btn-danger px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-btn-danger-hover"
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
