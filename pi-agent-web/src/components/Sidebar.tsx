import clsx from "clsx";
import { useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { relativeTime, truncate } from "../lib/format";
import { useAgent } from "../state/agent";
import { ConfirmPopover } from "./ConfirmPopover";
import { CpuIcon, DatabaseIcon, LayersIcon, PencilIcon, PlusIcon, TrashIcon } from "./icons";

interface SidebarProps {
	onOpenProviders: () => void;
	onOpenSkills: () => void;
	onOpenKnowledge: () => void;
	onClose: () => void;
}

export function Sidebar({ onOpenProviders, onOpenSkills, onOpenKnowledge, onClose }: SidebarProps) {
	const { t, lang } = useI18n();
	const {
		online,
		sessions,
		activeId,
		selectSession,
		newSession,
		removeSession,
		renameSession,
	} = useAgent();
	const [query, setQuery] = useState("");
	const [pendingDelete, setPendingDelete] = useState<{ id: string; label: string; anchor: DOMRect } | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editingValue, setEditingValue] = useState("");
	const skipBlurRef = useRef(false);

	const stopEditing = () => {
		skipBlurRef.current = true;
		setEditingId(null);
		setEditingValue("");
	};

	const commitRename = (id: string) => {
		if (skipBlurRef.current) {
			skipBlurRef.current = false;
			return;
		}
		const next = editingValue.trim();
		stopEditing();
		if (next) void renameSession(id, next);
	};

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		const list = [...sessions].sort((a, b) => {
			const am = typeof a.modified === "number" ? a.modified : Date.parse(String(a.modified ?? 0)) || 0;
			const bm = typeof b.modified === "number" ? b.modified : Date.parse(String(b.modified ?? 0)) || 0;
			return bm - am;
		});
		if (!q) return list;
		return list.filter((s) =>
			[s.name, s.firstMessage, s.id].some((v) => (v ?? "").toLowerCase().includes(q)),
		);
	}, [sessions, query]);

	const handleSelect = (id: string) => {
		void selectSession(id);
		onClose();
	};

	return (
		<aside className="flex h-full w-[268px] shrink-0 flex-col border-r border-border bg-panel">
			<div className="flex h-[52px] shrink-0 items-center gap-2 px-3">
				<span className="pi-mark" aria-hidden>
					π
				</span>
				<div className="min-w-0 flex-1">
					<div className="truncate text-[13px] font-semibold tracking-tight">{t("app.title")}</div>
					<div className="mt-0.5 flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-dim">
						<span
							className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", online ? "bg-ok" : "bg-red-400")}
							title={online ? t("chat.online") : t("chat.offline")}
						/>
						<span className="truncate">{online ? "127.0.0.1:8787" : t("chat.offline")}</span>
					</div>
				</div>
				<button
					type="button"
					onClick={() => void newSession()}
					title={t("app.newSession")}
					className="flex h-7 shrink-0 items-center gap-1 rounded-[4px] bg-btn-accent px-2 text-[12px] font-medium text-accent-contrast hover:bg-btn-accent-hover"
				>
					<PlusIcon size={13} />
					{t("app.newSession")}
				</button>
			</div>

			<div className="px-3 pb-2">
				<input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={t("app.searchSessions")}
					className="w-full rounded-[4px] border border-border bg-bg px-2.5 py-1.5 text-[12.5px] outline-none placeholder:text-dim focus:border-accent"
				/>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
				{!online && (
					<div className="m-2 rounded-[4px] border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[12px] text-red-400">
						{t("app.offline")}
					</div>
				)}
				{filtered.length === 0 && (
					<div className="px-2 py-6 text-center text-[12.5px] text-dim">{t("app.emptySessions")}</div>
				)}
				{filtered.map((s) => {
					const active = s.id === activeId;
					const label = s.name || (s.firstMessage ? truncate(s.firstMessage, 60) : s.id.slice(0, 8));
					return (
						<div
							key={s.id}
							className={clsx(
								"group relative mb-0.5 cursor-pointer rounded-[4px]",
								active ? "bg-selected" : "hover:bg-hover",
							)}
							onClick={() => handleSelect(s.id)}
						>
							{active && (
								<span
									className="absolute bottom-1.5 left-0 top-1.5 w-[2px] rounded-full bg-accent"
									aria-hidden
								/>
							)}
							<div className="px-3 py-2">
								<div className="flex items-center gap-1.5">
									{s.isOpen && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
									{editingId === s.id ? (
										<input
											autoFocus
											value={editingValue}
											onChange={(e) => setEditingValue(e.target.value)}
											onClick={(e) => e.stopPropagation()}
											onKeyDown={(e) => {
												e.stopPropagation();
												if (e.key === "Enter") commitRename(s.id);
												if (e.key === "Escape") stopEditing();
											}}
											onBlur={() => commitRename(s.id)}
											className="min-w-0 flex-1 rounded-[3px] border border-accent bg-bg px-1.5 py-0.5 text-[13px] font-medium outline-none"
										/>
									) : (
										<span className="truncate text-[13px] font-medium">{label}</span>
									)}
								</div>
								<div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-dim">
									{typeof s.messageCount === "number" && (
										<span>{t("sessions.messages", { n: s.messageCount })}</span>
									)}
									<span>{relativeTime(s.modified, lang)}</span>
								</div>
							</div>
							<div
								className={clsx(
									"absolute right-1.5 top-1.5 gap-0.5",
									editingId === s.id ? "hidden" : "hidden group-hover:flex",
								)}
							>
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										skipBlurRef.current = false;
										setEditingId(s.id);
										setEditingValue(s.name ?? "");
									}}
									title={t("sessions.rename")}
									className="flex h-6 w-6 items-center justify-center rounded-[3px] bg-bg/80 text-muted hover:text-text"
								>
									<PencilIcon size={12} />
								</button>
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										setPendingDelete({
											id: s.id,
											label,
											anchor: e.currentTarget.getBoundingClientRect(),
										});
									}}
									title={t("sessions.delete")}
									className="flex h-6 w-6 items-center justify-center rounded-[3px] bg-bg/80 text-muted hover:text-red-400"
								>
									<TrashIcon size={12} />
								</button>
							</div>
						</div>
					);
				})}
			</div>

			<div className="flex items-center gap-1 border-t border-border p-2">
				<button
					type="button"
					onClick={onOpenProviders}
					className="flex flex-1 items-center justify-center gap-1.5 rounded-[4px] px-2 py-1.5 text-[12.5px] text-muted hover:bg-btn-hover hover:text-text"
				>
					<CpuIcon size={14} />
					{t("app.providers")}
				</button>
				<button
					type="button"
					onClick={onOpenSkills}
					className="flex flex-1 items-center justify-center gap-1.5 rounded-[4px] px-2 py-1.5 text-[12.5px] text-muted hover:bg-btn-hover hover:text-text"
				>
					<LayersIcon size={14} />
					{t("app.skills")}
				</button>
				<button
					type="button"
					onClick={onOpenKnowledge}
					className="flex flex-1 items-center justify-center gap-1.5 rounded-[4px] px-2 py-1.5 text-[12.5px] text-muted hover:bg-btn-hover hover:text-text"
				>
					<DatabaseIcon size={14} />
					{t("app.knowledge")}
				</button>
			</div>

			<ConfirmPopover
				anchor={pendingDelete?.anchor ?? null}
				message={
					pendingDelete
						? `${t("sessions.deleteConfirm")}\n${pendingDelete.label}`
						: t("sessions.deleteConfirm")
				}
				confirmLabel={t("sessions.delete")}
				cancelLabel={t("common.cancel")}
				onCancel={() => setPendingDelete(null)}
				onConfirm={() => {
					const target = pendingDelete;
					setPendingDelete(null);
					if (target) void removeSession(target.id);
				}}
			/>
		</aside>
	);
}
