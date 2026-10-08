import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import * as api from "../lib/api";
import { truncate } from "../lib/format";
import type { KbDocument, KbIngestJob, KnowledgeBase } from "../lib/types";
import { useAgent } from "../state/agent";
import { DatabaseIcon, PencilIcon, PlusIcon, TrashIcon } from "./icons";
import { Modal } from "./Modal";

interface KnowledgePanelProps {
	open: boolean;
	onClose: () => void;
}

type EditState =
	| { mode: "create" }
	| { mode: "edit"; kb: KnowledgeBase }
	| null;

const KB_POLL_MS = 3000;

export function KnowledgePanel({ open, onClose }: KnowledgePanelProps) {
	const { t } = useI18n();
	const { kbs, kbService, kbActiveId, refreshKbs, updateSettings, settings } = useAgent();
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [edit, setEdit] = useState<EditState>(null);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [docs, setDocs] = useState<Record<string, KbDocument[]>>({});
	const [docsLoadingId, setDocsLoadingId] = useState<string | null>(null);
	const [uploading, setUploading] = useState(false);
	const [pendingDelete, setPendingDelete] = useState<KnowledgeBase | null>(null);
	const [activatingId, setActivatingId] = useState<string | null>(null);
	const [job, setJob] = useState<{ kbId: string; jobId: string; data: KbIngestJob } | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const pollTimerRef = useRef<number | null>(null);

	/* Refresh overview while the panel is open (service start / ingest). */
	useEffect(() => {
		if (!open) return;
		void refreshKbs();
		const timer = window.setInterval(() => void refreshKbs(), KB_POLL_MS);
		return () => window.clearInterval(timer);
	}, [open, refreshKbs]);

	/* Poll the ingest job until it settles. */
	useEffect(() => {
		if (!job) return;
		if (job.data.status === "done" || job.data.status === "failed") return;
		const timer = window.setInterval(async () => {
			try {
				const data = await api.getKbJob(job.jobId);
				setJob((prev) => (prev ? { ...prev, data } : prev));
				if (data.status === "done" || data.status === "failed") {
					await refreshKbs();
					if (expandedId) await loadDocs(expandedId);
				}
			} catch {
				/* keep polling; job may have expired from the RAG service's ring buffer */
			}
		}, KB_POLL_MS);
		pollTimerRef.current = timer;
		return () => window.clearInterval(timer);
	}, [job, refreshKbs, expandedId]);

	const loadDocs = useCallback(async (id: string) => {
		setDocsLoadingId(id);
		try {
			const res = await api.listKbDocuments(id);
			setDocs((prev) => ({ ...prev, [id]: res.documents }));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setDocsLoadingId(null);
		}
	}, []);

	/* Load documents for the expanded KB. */
	useEffect(() => {
		if (open && expandedId) void loadDocs(expandedId);
	}, [open, expandedId, loadDocs]);

	const showNotice = (message: string) => {
		setNotice(message);
		window.setTimeout(() => setNotice((prev) => (prev === message ? null : prev)), 4000);
	};

	const activate = async (kb: KnowledgeBase) => {
		setActivatingId(kb.id);
		setError(null);
		try {
			const res = await api.activateKb(kb.id);
			if (res.warnings?.length) showNotice(res.warnings.join("；"));
			else showNotice(t("kb.activated"));
			await refreshKbs();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setActivatingId(null);
		}
	};

	const startService = async () => {
		setError(null);
		try {
			await api.startKbService();
			showNotice(t("kb.service.starting"));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const ingest = async (kb: KnowledgeBase) => {
		setError(null);
		try {
			if (kb.id !== kbActiveId) {
				await api.activateKb(kb.id);
				await refreshKbs();
			}
			const res = await api.ingestKb(kb.id);
			setJob({ kbId: kb.id, jobId: res.job_id, data: { job_id: res.job_id, status: "running", stage: "", done: 0, total: 0, detail: "", result: null, error: null, logs: [] } });
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const uploadFiles = async (files: FileList) => {
		if (!expandedId || files.length === 0) return;
		setUploading(true);
		setError(null);
		try {
			for (const file of Array.from(files)) {
				const buffer = await file.arrayBuffer();
				let binary = "";
				const bytes = new Uint8Array(buffer);
				const chunk = 0x8000;
				for (let i = 0; i < bytes.length; i += chunk) {
					binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
				}
				const base64 = btoa(binary);
				await api.uploadKbDocument(expandedId, file.name, base64);
			}
			await loadDocs(expandedId);
			showNotice(t("kb.saved"));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setUploading(false);
			if (fileInputRef.current) fileInputRef.current.value = "";
		}
	};

	const removeDoc = async (kb: KnowledgeBase, name: string) => {
		setError(null);
		try {
			await api.deleteKbDocument(kb.id, name);
			await loadDocs(kb.id);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const removeKb = async () => {
		const kb = pendingDelete;
		setPendingDelete(null);
		if (!kb) return;
		setError(null);
		try {
			await api.deleteKb(kb.id);
			if ((settings.kbId ?? "") === kb.id) updateSettings({ kbId: null });
			if (expandedId === kb.id) setExpandedId(null);
			await refreshKbs();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const service = kbService;
	const serviceBadge = (() => {
		if (!service) return null;
		if (service.starting && !service.online) {
			return <span className="rounded-[3px] border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-500">{t("kb.service.starting")}</span>;
		}
		if (!service.online) {
			return <span className="rounded-[3px] border border-red-500/40 bg-red-500/10 px-2 py-0.5 font-mono text-[10px] text-red-400">{t("kb.service.offline")}</span>;
		}
		const h = service.health;
		if (!h) return null;
		if (h.ingest_running) {
			return <span className="rounded-[3px] border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-500">{t("kb.service.ingestRunning")}</span>;
		}
		if (!h.index_ready) {
			return <span className="rounded-[3px] border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-500">{t("kb.service.noIndex")}</span>;
		}
		const ready = h.embedder_loaded && h.reranker_loaded;
		return (
			<span
				className={clsx(
					"rounded-[3px] border px-2 py-0.5 font-mono text-[10px]",
					ready ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500" : "border-border bg-hover text-muted",
				)}
			>
				{ready ? t("kb.service.indexReady") : t("kb.service.modelNotLoaded")}
			</span>
		);
	})();

	return (
		<Modal open={open} onClose={onClose} title={t("kb.title")} widthClass="max-w-3xl">
			<div className="flex flex-col gap-4">
				{/* service status */}
				<div className="flex flex-wrap items-center gap-2 rounded-[4px] border border-border bg-panel/50 px-3 py-2.5">
					<DatabaseIcon size={15} className="shrink-0 text-muted" />
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
						{serviceBadge}
						{service?.online && service.health && (
							<span className="font-mono text-[10.5px] text-dim">
								{t("kb.service.chunks", { n: service.health.num_chunks })}
							</span>
						)}
					</div>
					{service && !service.online && !service.starting && (
						<button
							type="button"
							onClick={() => void startService()}
							className="rounded-[4px] bg-btn-accent px-2.5 py-1 text-[12px] font-medium text-accent-contrast hover:bg-btn-accent-hover"
						>
							{t("kb.service.start")}
						</button>
					)}
				</div>

				<p className="text-[12px] leading-relaxed text-dim">{t("kb.hint")}</p>

				{error && (
					<div className="rounded-[4px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-400">
						{error}
					</div>
				)}
				{notice && !error && (
					<div className="rounded-[4px] border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[12.5px] text-emerald-500">
						{notice}
					</div>
				)}

				{kbs.length === 0 && (
					<div className="rounded-[4px] border border-border bg-panel/50 px-4 py-6 text-center text-[12.5px] text-dim">
						{t("kb.empty")}
					</div>
				)}

				{kbs.map((kb) => {
					const active = kb.id === kbActiveId;
					const expanded = expandedId === kb.id;
					const kbDocs = docs[kb.id] ?? [];
					const jobForThis = job?.kbId === kb.id ? job : null;
					return (
						<div
							key={kb.id}
							className={clsx(
								"rounded-[4px] border bg-panel/50",
								active ? "border-accent/60" : "border-border",
							)}
						>
							{/* header */}
							<div className="flex items-start gap-2 px-3 py-2.5">
								<button
									type="button"
									onClick={() => setExpandedId(expanded ? null : kb.id)}
									className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
								>
									<div className="flex flex-wrap items-center gap-2">
										<span className="truncate text-[13px] font-medium">{kb.name}</span>
										{active && (
											<span className="rounded-[3px] bg-accent/15 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-accent">
												{t("kb.list.current")}
											</span>
										)}
										<span className="rounded-[3px] border border-border px-1.5 py-0.5 font-mono text-[9.5px] text-dim">
											{kb.managed ? t("kb.list.managed") : t("kb.list.external")}
										</span>
									</div>
									<div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-dim">
										<span>{t("kb.list.docs", { n: kb.docCount ?? 0 })}</span>
									</div>
									{kb.description && (
										<span className="text-[12px] leading-relaxed text-muted">{truncate(kb.description, 120)}</span>
									)}
								</button>
								<div className="flex shrink-0 items-center gap-1">
									{!active && (
										<button
											type="button"
											onClick={() => void activate(kb)}
											disabled={activatingId !== null}
											title={t("kb.activate")}
											className="rounded-[4px] border border-border px-2 py-1 text-[11.5px] text-muted hover:border-accent hover:text-text disabled:cursor-wait disabled:opacity-50"
										>
											{activatingId === kb.id ? t("kb.activating") : t("kb.activate")}
										</button>
									)}
									<button
										type="button"
										onClick={() => setEdit({ mode: "edit", kb })}
										title={t("kb.edit")}
										className="flex h-7 w-7 items-center justify-center rounded-[3px] text-muted hover:bg-btn-hover hover:text-text"
									>
										<PencilIcon size={12} />
									</button>
									<button
										type="button"
										onClick={() => setPendingDelete(kb)}
										title={t("kb.delete")}
										className="flex h-7 w-7 items-center justify-center rounded-[3px] text-muted hover:bg-btn-hover hover:text-red-400"
									>
										<TrashIcon size={12} />
									</button>
								</div>
							</div>

							{/* expanded: documents */}
							{expanded && (
								<div className="border-t border-border px-3 py-2.5">
									<div className="mb-2 flex flex-wrap items-center gap-2">
										<span className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
											{t("kb.docs.title")}
										</span>
										<span className="flex-1" />
										<input
											ref={fileInputRef}
											type="file"
											multiple
											hidden
											onChange={(e) => e.target.files && void uploadFiles(e.target.files)}
										/>
										<button
											type="button"
											onClick={() => fileInputRef.current?.click()}
											disabled={uploading}
											className="rounded-[4px] border border-border px-2 py-1 text-[11.5px] text-muted hover:border-accent hover:text-text disabled:cursor-wait disabled:opacity-50"
										>
											{uploading ? t("kb.docs.uploading") : t("kb.docs.upload")}
										</button>
										<button
											type="button"
											onClick={() => void ingest(kb)}
											disabled={Boolean(jobForThis && jobForThis.data.status !== "done" && jobForThis.data.status !== "failed")}
											className="rounded-[4px] bg-btn-accent px-2 py-1 text-[11.5px] font-medium text-accent-contrast hover:bg-btn-accent-hover disabled:cursor-wait disabled:opacity-50"
										>
											{jobForThis && jobForThis.data.status === "running"
												? t("kb.ingest.ingesting")
												: t("kb.ingest")}
										</button>
									</div>
									<p className="mb-2 text-[11.5px] leading-relaxed text-dim">{t("kb.docs.hint")}</p>

									{/* job progress */}
									{jobForThis && (
										<div className="mb-2 rounded-[4px] border border-border bg-bg px-2.5 py-2 font-mono text-[11px]">
											{jobForThis.data.status === "done" ? (
												<span className="text-emerald-500">
													{t("kb.ingest.done", {
														reused: jobForThis.data.result?.files_reused ?? 0,
														added: jobForThis.data.result?.files_added ?? 0,
														chunks: jobForThis.data.result?.chunks ?? 0,
														embedded: jobForThis.data.result?.chunks_embedded ?? 0,
														sec: jobForThis.data.result?.took_sec ?? 0,
													})}
													{(jobForThis.data.result?.files_removed ?? 0) > 0
														? ` · ${t("kb.ingest.removed", { n: jobForThis.data.result?.files_removed ?? 0 })}`
														: ""}
												</span>
											) : jobForThis.data.status === "failed" ? (
												<span className="text-red-400">
													{t("kb.ingest.failed")}: {jobForThis.data.error}
												</span>
											) : (
												<span>
													{t("kb.ingest.stage")}: {jobForThis.data.stage || "queued"} ·{" "}
													{t("kb.ingest.progress", { done: jobForThis.data.done, total: jobForThis.data.total })}
													{jobForThis.data.detail ? ` · ${jobForThis.data.detail}` : ""}
												</span>
											)}
											{jobForThis.data.logs?.length > 0 && (
												<details className="mt-1.5">
													<summary className="cursor-pointer text-[10.5px] text-dim">{t("kb.ingest.logs")}</summary>
													<pre className="mt-1 max-h-[140px] overflow-auto whitespace-pre-wrap break-all text-[10.5px] leading-relaxed text-muted">
														{jobForThis.data.logs.join("\n")}
													</pre>
												</details>
											)}
										</div>
									)}

									{docsLoadingId === kb.id ? (
										<div className="py-2 text-center text-[12px] text-dim">{t("kb.loading")}</div>
									) : kbDocs.length === 0 ? (
										<div className="py-2 text-center text-[12px] text-dim">{t("kb.docs.empty")}</div>
									) : (
										<ul className="flex flex-col gap-0.5">
											{kbDocs.map((doc) => (
												<li
													key={doc.name}
													className="group flex items-center gap-2 rounded-[3px] px-1.5 py-1 hover:bg-hover"
												>
													<span className="min-w-0 flex-1 truncate font-mono text-[11.5px]" title={doc.name}>
														{doc.name}
													</span>
													<span className="shrink-0 font-mono text-[10px] text-dim">{formatBytes(doc.size)}</span>
													<button
														type="button"
														onClick={() => void removeDoc(kb, doc.name)}
														title={t("kb.docs.delete")}
														className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-[3px] text-muted group-hover:flex hover:text-red-400"
													>
														<TrashIcon size={11} />
													</button>
												</li>
											))}
										</ul>
									)}
								</div>
							)}
						</div>
					);
				})}

				{/* new KB */}
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => setEdit({ mode: "create" })}
						className="flex items-center gap-1.5 rounded-[4px] border border-border px-2.5 py-1.5 text-[12.5px] text-muted hover:border-accent hover:text-text"
					>
						<PlusIcon size={13} />
						{t("kb.new")}
					</button>
				</div>
			</div>

			{/* edit / create form */}
			{edit && (
				<KbEditDialog
					key={edit.mode === "edit" ? edit.kb.id : "create"}
					edit={edit}
					onDone={async (saved) => {
						setEdit(null);
						if (saved) {
							await refreshKbs();
							showNotice(t("kb.saved"));
						}
					}}
				/>
			)}

			{/* delete confirm */}
			{pendingDelete && (
				<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
					<div className="fade-in relative z-10 w-full max-w-md rounded-[6px] border border-border bg-bg p-4 shadow-[var(--shadow-pop)]">
						<p className="text-[13px] leading-relaxed">
							{t("kb.deleteConfirm", {
								extra: pendingDelete.managed ? t("kb.deleteConfirmManaged") : t("kb.deleteConfirmExternal"),
							})}
						</p>
						<p className="mt-1 font-mono text-[12px] text-dim">{pendingDelete.name}</p>
						<div className="mt-3 flex justify-end gap-2">
							<button
								type="button"
								onClick={() => setPendingDelete(null)}
								className="rounded-[4px] border border-border px-2.5 py-1 text-[12.5px] text-muted hover:text-text"
							>
								{t("common.cancel")}
							</button>
							<button
								type="button"
								onClick={() => void removeKb()}
								className="rounded-[4px] bg-btn-danger px-2.5 py-1 text-[12.5px] font-medium text-white hover:bg-btn-danger-hover"
							>
								{t("kb.delete")}
							</button>
						</div>
					</div>
				</div>
			)}
		</Modal>
	);
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function KbEditDialog({
	edit,
	onDone,
}: {
	edit: Exclude<EditState, null>;
	onDone: (saved: boolean) => void | Promise<void>;
}) {
	const { t } = useI18n();
	const existing = edit.mode === "edit" ? edit.kb : null;
	const [name, setName] = useState(existing?.name ?? "");
	const [description, setDescription] = useState(existing?.description ?? "");
	const [busy, setBusy] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);

	const submit = async () => {
		setFormError(null);
		if (!name.trim()) {
			setFormError(t("providers.invalid"));
			return;
		}
		setBusy(true);
		try {
			if (existing) {
				await api.updateKb(existing.id, { name: name.trim(), description });
			} else {
				await api.createKb({ name: name.trim(), description });
			}
			await onDone(true);
		} catch (err) {
			setFormError(err instanceof Error ? err.message : String(err));
			setBusy(false);
		}
	};

	const inputClass =
		"w-full rounded-[4px] border border-border bg-bg px-2.5 py-1.5 text-[12.5px] outline-none placeholder:text-dim focus:border-accent";

	return (
		<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
			<div className="fade-in relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-[6px] border border-border bg-bg shadow-[var(--shadow-pop)]">
				<div className="flex h-11 shrink-0 items-center border-b border-border px-4">
					<span className="flex-1 text-[13.5px] font-semibold tracking-tight">
						{existing ? t("kb.edit") : t("kb.new")}
					</span>
				</div>
				<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
					{formError && (
						<div className="rounded-[4px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-400">
							{formError}
						</div>
					)}
					<label className="flex flex-col gap-1">
						<span className="text-[12px] text-muted">{t("kb.name")}</span>
						<input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoFocus />
					</label>
					<label className="flex flex-col gap-1">
						<span className="text-[12px] text-muted">{t("kb.description")}</span>
						<input
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder={t("kb.descriptionPlaceholder")}
							className={inputClass}
						/>
					</label>
					{existing && (
						<p className="font-mono text-[10.5px] leading-relaxed text-dim" title={existing.paths.data_dir}>
							{t("kb.paths")}: {existing.paths.data_dir}
						</p>
					)}
				</div>
				<div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
					<button
						type="button"
						onClick={() => void onDone(false)}
						disabled={busy}
						className="rounded-[4px] border border-border px-2.5 py-1 text-[12.5px] text-muted hover:text-text disabled:cursor-wait disabled:opacity-50"
					>
						{t("kb.cancel")}
					</button>
					<button
						type="button"
						onClick={() => void submit()}
						disabled={busy}
						className="rounded-[4px] bg-btn-accent px-2.5 py-1 text-[12.5px] font-medium text-accent-contrast hover:bg-btn-accent-hover disabled:cursor-wait disabled:opacity-50"
					>
						{busy ? t("kb.loading") : t("kb.save")}
					</button>
				</div>
			</div>
		</div>
	);
}
