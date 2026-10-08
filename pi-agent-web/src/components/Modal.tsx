import { useEffect, type ReactNode } from "react";
import { CloseIcon } from "./icons";

interface ModalProps {
	open: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
	widthClass?: string;
}

export function Modal({ open, onClose, title, children, widthClass = "max-w-2xl" }: ModalProps) {
	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[8vh]">
			<div
				className="absolute inset-0"
				onClick={onClose}
				aria-hidden
			/>
			<div
				className={`fade-in relative z-10 flex max-h-[80vh] w-full ${widthClass} flex-col overflow-hidden rounded-[6px] border border-border bg-bg shadow-[var(--shadow-pop)]`}
			>
				<div className="flex h-11 shrink-0 items-center border-b border-border px-4">
					<span className="flex-1 text-[13.5px] font-semibold tracking-tight">{title}</span>
					<button
						type="button"
						onClick={onClose}
						className="flex h-8 w-8 items-center justify-center rounded-[4px] text-muted hover:bg-btn-hover hover:text-text"
					>
						<CloseIcon size={16} />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
			</div>
		</div>
	);
}
