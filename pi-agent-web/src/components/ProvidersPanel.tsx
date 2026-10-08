import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n";
import * as api from "../lib/api";
import { API_TYPES, PROVIDER_PRESETS } from "../lib/providerPresets";
import type { ProviderConfig, ProviderModelConfig } from "../lib/types";
import { useAgent } from "../state/agent";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";
import { PencilIcon, PlusIcon, TrashIcon } from "./icons";

interface ProvidersPanelProps {
	open: boolean;
	onClose: () => void;
}

interface EditorState {
	mode: "new" | "edit";
	originalId: string;
	id: string;
	name: string;
	baseUrl: string;
	api: string;
	apiKey: string;
	models: ProviderModelConfig[];
}

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

function emptyEditor(): EditorState {
	return {
		mode: "new",
		originalId: "",
		id: "",
		name: "",
		baseUrl: "",
		api: "openai-completions",
		apiKey: "",
		models: [{ id: "", reasoning: false, input: ["text"] }],
	};
}

export function ProvidersPanel({ open, onClose }: ProvidersPanelProps) {
	const { t } = useI18n();
	const { refreshModels } = useAgent();
	const [providers, setProviders] = useState<ProviderConfig[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [editor, setEditor] = useState<EditorState | null>(null);
	const [pendingDelete, setPendingDelete] = useState<ProviderConfig | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const res = await api.listProviders();
			setProviders(res.providers);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (open) void load();
	}, [open, load]);

	const openEdit = (p: ProviderConfig) => {
		setNotice(null);
		setEditor({
			mode: "edit",
			originalId: p.id,
			id: p.id,
			name: p.name ?? "",
			baseUrl: p.baseUrl ?? "",
			api: p.api ?? "openai-completions",
			apiKey: "",
			models: (p.models ?? []).map((m) => ({ ...m })),
		});
	};

	const applyPreset = (key: string) => {
		const preset = PROVIDER_PRESETS.find((p) => p.key === key);
		if (!preset) return;
		setEditor((prev) =>
			prev
				? {
						...prev,
						id: prev.mode === "new" ? preset.id : prev.id,
						name: preset.name,
						baseUrl: preset.baseUrl,
						api: preset.api,
						models: preset.models.map((m) => ({ ...m })),
					}
				: prev,
		);
	};

	const save = async () => {
		if (!editor) return;
		const models = editor.models.filter((m) => m.id.trim());
		if (!editor.baseUrl.trim() || models.length === 0) {
			setError(t("providers.invalid"));
			return;
		}
		if (editor.mode === "new" && !ID_PATTERN.test(editor.id.trim())) {
			setError("id: [a-zA-Z0-9][a-zA-Z0-9_-]*");
			return;
		}
		setError(null);
		try {
			if (editor.mode === "new") {
				await api.putProvider(editor.id.trim(), {
					name: editor.name.trim() || undefined,
					baseUrl: editor.baseUrl.trim(),
					api: editor.api.trim() || undefined,
					...(editor.apiKey ? { apiKey: editor.apiKey } : {}),
					models,
				});
			} else {
				await api.patchProvider(editor.originalId, {
					name: editor.name.trim(),
					baseUrl: editor.baseUrl.trim(),
					api: editor.api.trim(),
					models,
					...(editor.apiKey ? { apiKey: editor.apiKey } : {}),
				});
			}
			setNotice(t("providers.saved"));
			setEditor(null);
			await load();
			await refreshModels();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const remove = async (p: ProviderConfig) => {
		try {
			await api.deleteProvider(p.id);
			await load();
			await refreshModels();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const clearKey = async (p: ProviderConfig) => {
		try {
			await api.patchProvider(p.id, { apiKey: null });
			await load();
			await refreshModels();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const updateModel = (index: number, patch: Partial<ProviderModelConfig>) => {
		setEditor((prev) =>
			prev
				? { ...prev, models: prev.models.map((m, i) => (i === index ? { ...m, ...patch } : m)) }
				: prev,
		);
	};

	const inputClass =
		"w-full rounded-[4px] border border-border bg-panel px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent";

	return (
		<>
			<Modal open={open} onClose={onClose} title={t("providers.title")} widthClass="max-w-3xl">
			<div className="flex flex-col gap-4">
				{error && (
					<div className="rounded-[4px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-400">
						{error}
					</div>
				)}
				{notice && (
					<div className="rounded-[4px] border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[12.5px] text-emerald-400">
						{notice}
					</div>
				)}

				{!editor && (
					<button
						type="button"
						onClick={() => {
							setNotice(null);
							setError(null);
							setEditor(emptyEditor());
						}}
						className="flex w-fit items-center gap-1.5 rounded-[4px] bg-btn-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-contrast hover:bg-btn-accent-hover"
					>
						<PlusIcon size={14} />
						{t("providers.add")}
					</button>
				)}

				{editor && (
					<div className="flex flex-col gap-3 rounded-[4px] border border-border bg-panel/50 p-3">
						{editor.mode === "new" && (
							<label className="flex flex-col gap-1">
								<span className="text-[12px] text-muted">{t("providers.presets")}</span>
								<select
									value=""
									onChange={(e) => {
										if (e.target.value) applyPreset(e.target.value);
									}}
									className={`${inputClass} cursor-pointer`}
								>
									<option value="">{t("providers.presetPlaceholder")}</option>
									{PROVIDER_PRESETS.map((p) => (
										<option key={p.key} value={p.key}>
											{p.label}
										</option>
									))}
								</select>
								<span className="text-[11px] text-dim">{t("providers.presetHint")}</span>
							</label>
						)}
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<label className="flex flex-col gap-1">
								<span className="text-[12px] text-muted">{t("providers.id")}</span>
								<input
									value={editor.id}
									onChange={(e) => setEditor({ ...editor, id: e.target.value })}
									disabled={editor.mode === "edit"}
									placeholder="deepseek"
									className={`${inputClass} disabled:opacity-60`}
								/>
							</label>
							<label className="flex flex-col gap-1">
								<span className="text-[12px] text-muted">{t("providers.name")}</span>
								<input
									value={editor.name}
									onChange={(e) => setEditor({ ...editor, name: e.target.value })}
									placeholder="DeepSeek"
									className={inputClass}
								/>
							</label>
							<label className="flex flex-col gap-1">
								<span className="text-[12px] text-muted">{t("providers.baseUrl")}</span>
								<input
									value={editor.baseUrl}
									onChange={(e) => setEditor({ ...editor, baseUrl: e.target.value })}
									placeholder="https://api.deepseek.com"
									className={inputClass}
								/>
							</label>
							<label className="flex flex-col gap-1">
								<span className="text-[12px] text-muted">{t("providers.api")}</span>
								<input
									value={editor.api}
									onChange={(e) => setEditor({ ...editor, api: e.target.value })}
									placeholder="openai-completions"
									list="provider-api-types"
									className={inputClass}
								/>
								<datalist id="provider-api-types">
									{API_TYPES.map((a) => (
										<option key={a.value} value={a.value}>
											{t(a.hintKey)}
										</option>
									))}
								</datalist>
								<span className="text-[11px] text-dim">
									{t(API_TYPES.find((a) => a.value === editor.api.trim())?.hintKey ?? "providers.apiHint")}
								</span>
							</label>
						</div>

						<label className="flex flex-col gap-1">
							<span className="text-[12px] text-muted">{t("providers.apiKey")}</span>
							<input
								type="password"
								value={editor.apiKey}
								onChange={(e) => setEditor({ ...editor, apiKey: e.target.value })}
								placeholder={editor.mode === "edit" ? t("providers.apiKeyKeep") : "sk-..."}
								className={inputClass}
							/>
							<span className="text-[11px] text-dim">{t("providers.apiKeyEnv")}</span>
						</label>

						<div className="flex flex-col gap-2">
							<div className="flex items-center justify-between">
								<span className="text-[12.5px] font-medium">{t("providers.models")}</span>
								<button
									type="button"
									onClick={() =>
										setEditor({ ...editor, models: [...editor.models, { id: "", input: ["text"] }] })
									}
									className="text-[12px] text-accent hover:underline"
								>
									+ {t("providers.addModel")}
								</button>
							</div>
							{editor.models.map((m, i) => (
								<div key={i} className="flex flex-wrap items-center gap-2 rounded-[4px] border border-border bg-bg px-2 py-1.5">
									<input
										value={m.id}
										onChange={(e) => updateModel(i, { id: e.target.value })}
										placeholder={t("providers.modelId")}
										className="min-w-[140px] flex-1 rounded border border-border bg-panel px-2 py-1 font-mono text-[12px] outline-none focus:border-accent"
									/>
									<input
										value={m.name ?? ""}
										onChange={(e) => updateModel(i, { name: e.target.value })}
										placeholder={t("providers.modelName")}
										className="min-w-[110px] flex-1 rounded border border-border bg-panel px-2 py-1 text-[12px] outline-none focus:border-accent"
									/>
									<input
										type="number"
										value={m.contextWindow ?? ""}
										onChange={(e) =>
											updateModel(i, {
												contextWindow: e.target.value ? Number(e.target.value) : undefined,
											})
										}
										placeholder="131072"
										className="w-24 rounded border border-border bg-panel px-2 py-1 text-[12px] outline-none focus:border-accent"
									/>
									<label className="flex items-center gap-1 text-[12px] text-muted">
										<input
											type="checkbox"
											checked={Boolean(m.reasoning)}
											onChange={(e) => updateModel(i, { reasoning: e.target.checked })}
											className="accent-[var(--accent)]"
										/>
										{t("providers.modelReasoning")}
									</label>
									<button
										type="button"
										onClick={() =>
											setEditor({ ...editor, models: editor.models.filter((_, idx) => idx !== i) })
										}
										className="flex h-6 w-6 items-center justify-center rounded text-dim hover:text-red-400"
									>
										<TrashIcon size={13} />
									</button>
								</div>
							))}
						</div>

						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => void save()}
								className="rounded-[4px] bg-btn-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-contrast hover:bg-btn-accent-hover"
							>
								{t("providers.save")}
							</button>
							<button
								type="button"
								onClick={() => {
									setEditor(null);
									setError(null);
								}}
								className="rounded-[4px] border border-border px-3 py-1.5 text-[12.5px] text-muted hover:bg-btn-hover"
							>
								{t("providers.cancel")}
							</button>
						</div>
					</div>
				)}

				{loading && providers.length === 0 && <div className="text-[12.5px] text-dim">…</div>}
				{!loading && providers.length === 0 && !editor && (
					<div className="py-6 text-center text-[12.5px] text-dim">{t("providers.empty")}</div>
				)}

				<div className="flex flex-col gap-2">
					{providers.map((p) => (
						<div key={p.id} className="flex flex-col gap-1 rounded-[4px] border border-border bg-panel/40 px-3 py-2.5">
							<div className="flex items-center gap-2">
								<span className="font-mono text-[13px] font-medium">{p.id}</span>
								{p.name && <span className="text-[12px] text-dim">{p.name}</span>}
								<span className="flex-1" />
								<span
									className={`rounded-full px-1.5 py-px text-[10px] ${
										p.hasApiKey ? "bg-emerald-500/15 text-emerald-400" : "bg-border/70 text-dim"
									}`}
								>
									{p.hasApiKey ? `${t("providers.keySet")} ${p.apiKeyMasked ?? ""}` : t("providers.keyUnset")}
								</span>
								<button
									type="button"
									onClick={() => openEdit(p)}
									title={t("providers.edit")}
									className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-btn-hover hover:text-text"
								>
									<PencilIcon size={14} />
								</button>
								<button
									type="button"
									onClick={() => setPendingDelete(p)}
									title={t("providers.delete")}
									className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-btn-hover hover:text-red-400"
								>
									<TrashIcon size={14} />
								</button>
							</div>
							<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-dim">
								<span className="font-mono">{p.baseUrl}</span>
								{p.api && <span>· {p.api}</span>}
								<span>· {p.models?.length ?? 0} {t("providers.models").toLowerCase()}</span>
								{p.hasApiKey && (
									<button type="button" onClick={() => void clearKey(p)} className="text-dim hover:text-red-400">
										· {t("providers.clearKey")}
									</button>
								)}
							</div>
						</div>
					))}
				</div>
			</div>
			</Modal>

			<ConfirmDialog
				open={pendingDelete !== null}
				title={t("providers.delete")}
				message={pendingDelete ? `${t("providers.confirmDelete")}\n(${pendingDelete.id})` : t("providers.confirmDelete")}
				confirmLabel={t("providers.delete")}
				cancelLabel={t("common.cancel")}
				onCancel={() => setPendingDelete(null)}
				onConfirm={() => {
					const target = pendingDelete;
					setPendingDelete(null);
					if (target) void remove(target);
				}}
			/>
		</>
	);
}
