import clsx from "clsx";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useI18n } from "../i18n";
import * as api from "../lib/api";
import type { KbRefreshResult, RagConfig, RagHeadingPattern } from "../lib/types";
import { useAgent } from "../state/agent";
import { PlusIcon, RefreshIcon, TrashIcon } from "./icons";

/* Defaults mirror the RAG dataclasses (src/config.py). GET /api/config may
 * return a partial file (POST is a full replace), so every load is merged
 * against these. */
const DEFAULT_CONFIG: RagConfig = {
	parser: {
		name: "docling",
		ocr: false,
		table_mode: "fast",
		skip_toc: true,
		device: "cuda",
		heading_patterns: [],
	},
	chunker: { name: "recursive", chunk_size: 500, chunk_overlap: 50 },
	embedder: {
		name: "jasper",
		model_name: "infgrad/Jasper-Token-Compression-600M",
		device: "cuda",
		dtype: "bfloat16",
		batch_size: 256,
		compression_ratio: 0.8,
	},
	store: { name: "faiss", distance_strategy: "MAX_INNER_PRODUCT" },
	retriever: { name: "hybrid", dense_top_k: 20, sparse_top_k: 20, rrf_k: 60 },
	reranker: { name: "bge", model_name: "BAAI/bge-reranker-v2-m3", top_k: 5, device: "cuda" },
	generator: { name: "none" },
	server: { host: "127.0.0.1", port: 8100, cors_origins: ["*"], warmup: true },
};

const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
const num = (v: unknown, d: number): number =>
	typeof v === "number" && Number.isFinite(v) ? v : d;
const str = (v: unknown, d: string): string => (typeof v === "string" && v ? v : d);

function normalizePatterns(value: unknown): RagHeadingPattern[] {
	if (!Array.isArray(value)) return [];
	const out: RagHeadingPattern[] = [];
	for (const item of value) {
		if (typeof item === "string") {
			out.push({ regex: item, level: 1 });
		} else if (item && typeof item === "object") {
			const o = item as Record<string, unknown>;
			if (typeof o.regex !== "string" || !o.regex) continue;
			out.push({ regex: o.regex, level: num(o.level, 1) });
		}
	}
	return out;
}

function normalizeConfig(raw: unknown): RagConfig {
	const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown>>;
	const sec = (name: string): Record<string, unknown> =>
		o[name] && typeof o[name] === "object" ? o[name] : {};
	const p = sec("parser");
	const c = sec("chunker");
	const e = sec("embedder");
	const st = sec("store");
	const r = sec("retriever");
	const rr = sec("reranker");
	const sv = sec("server");
	return {
		parser: {
			name: str(p.name, DEFAULT_CONFIG.parser.name),
			ocr: bool(p.ocr, DEFAULT_CONFIG.parser.ocr),
			table_mode: str(p.table_mode, DEFAULT_CONFIG.parser.table_mode),
			skip_toc: bool(p.skip_toc, DEFAULT_CONFIG.parser.skip_toc),
			device: str(p.device, DEFAULT_CONFIG.parser.device),
			heading_patterns: normalizePatterns(p.heading_patterns),
		},
		chunker: {
			name: str(c.name, DEFAULT_CONFIG.chunker.name),
			chunk_size: num(c.chunk_size, DEFAULT_CONFIG.chunker.chunk_size),
			chunk_overlap: num(c.chunk_overlap, DEFAULT_CONFIG.chunker.chunk_overlap),
		},
		embedder: {
			name: str(e.name, DEFAULT_CONFIG.embedder.name),
			model_name: str(e.model_name, DEFAULT_CONFIG.embedder.model_name),
			device: str(e.device, DEFAULT_CONFIG.embedder.device),
			dtype: str(e.dtype, DEFAULT_CONFIG.embedder.dtype),
			batch_size: num(e.batch_size, DEFAULT_CONFIG.embedder.batch_size),
			compression_ratio: num(e.compression_ratio, DEFAULT_CONFIG.embedder.compression_ratio),
		},
		store: {
			name: str(st.name, DEFAULT_CONFIG.store.name),
			distance_strategy: str(st.distance_strategy, DEFAULT_CONFIG.store.distance_strategy),
		},
		retriever: {
			name: str(r.name, DEFAULT_CONFIG.retriever.name),
			dense_top_k: num(r.dense_top_k, DEFAULT_CONFIG.retriever.dense_top_k),
			sparse_top_k: num(r.sparse_top_k, DEFAULT_CONFIG.retriever.sparse_top_k),
			rrf_k: num(r.rrf_k, DEFAULT_CONFIG.retriever.rrf_k),
		},
		reranker: {
			name: str(rr.name, DEFAULT_CONFIG.reranker.name),
			model_name: str(rr.model_name, DEFAULT_CONFIG.reranker.model_name),
			top_k: num(rr.top_k, DEFAULT_CONFIG.reranker.top_k),
			device: str(rr.device, DEFAULT_CONFIG.reranker.device),
		},
		generator: { name: str(sec("generator").name, DEFAULT_CONFIG.generator.name) },
		server: {
			host: str(sv.host, DEFAULT_CONFIG.server.host),
			port: num(sv.port, DEFAULT_CONFIG.server.port),
			cors_origins: Array.isArray(sv.cors_origins)
				? sv.cors_origins.filter((v): v is string => typeof v === "string")
				: DEFAULT_CONFIG.server.cors_origins,
			warmup: bool(sv.warmup, DEFAULT_CONFIG.server.warmup),
		},
	};
}

function isValidRegex(value: string): boolean {
	if (!value.trim()) return false;
	try {
		new RegExp(value);
		return true;
	} catch {
		return false;
	}
}

/* ------------------------------------------------------------- UI primitives */

const inputClass =
	"w-full rounded-[4px] border border-border bg-bg px-2.5 py-1.5 text-[12.5px] outline-none placeholder:text-dim focus:border-accent";

function SectionTitle({ children }: { children: ReactNode }) {
	return (
		<span className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">{children}</span>
	);
}

function Toggle({
	checked,
	onChange,
	label,
}: {
	checked: boolean;
	onChange: (v: boolean) => void;
	label: string;
}) {
	return (
		<label className="flex cursor-pointer items-center justify-between gap-2 rounded-[4px] border border-border bg-panel/50 px-2.5 py-1.5">
			<span className="text-[12px] text-muted">{label}</span>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				onClick={() => onChange(!checked)}
				className={clsx(
					"relative h-5 w-9 shrink-0 rounded-full border transition-colors",
					checked ? "border-btn-accent bg-btn-accent" : "border-border bg-hover",
				)}
			>
				<span
					className={clsx(
						"absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all",
						checked ? "left-[18px]" : "left-[2px]",
					)}
				/>
			</button>
		</label>
	);
}

function Segmented({
	value,
	options,
	onChange,
}: {
	value: string;
	options: readonly string[];
	onChange: (v: string) => void;
}) {
	return (
		<div className="flex flex-wrap gap-1">
			{options.map((opt) => (
				<button
					key={opt}
					type="button"
					onClick={() => onChange(opt)}
					className={clsx(
						"rounded-[4px] border px-2.5 py-1 font-mono text-[11.5px]",
						value === opt
							? "border-accent bg-accent/15 text-accent"
							: "border-border text-muted hover:bg-btn-hover",
					)}
				>
					{opt}
				</button>
			))}
		</div>
	);
}

function NumberField({
	label,
	value,
	min,
	max,
	step,
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	onChange: (v: number) => void;
}) {
	const [text, setText] = useState(String(value));
	useEffect(() => setText(String(value)), [value]);
	return (
		<label className="flex flex-col gap-1">
			<span className="text-[11.5px] text-dim">{label}</span>
			<input
				type="number"
				value={text}
				min={min}
				max={max}
				step={step}
				onChange={(e) => {
					setText(e.target.value);
					if (e.target.value !== "") {
						const v = Number(e.target.value);
						if (Number.isFinite(v)) onChange(v);
					}
				}}
				onBlur={() => setText(String(value))}
				className={inputClass}
			/>
		</label>
	);
}

function TextField({
	label,
	value,
	onChange,
	mono = true,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	mono?: boolean;
}) {
	return (
		<label className="flex flex-col gap-1">
			<span className="text-[11.5px] text-dim">{label}</span>
			<input
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className={clsx(inputClass, mono && "font-mono")}
			/>
		</label>
	);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-1">
			<span className="text-[11.5px] text-dim">{label}</span>
			{children}
		</div>
	);
}

/* -------------------------------------------------------------- main section */

export function RagConfigSection() {
	const { t } = useI18n();
	const { kbService, kbActiveId, refreshKbs } = useAgent();
	const [config, setConfig] = useState<RagConfig | null>(null);
	const [loaded, setLoaded] = useState<RagConfig | null>(null);
	const [paths, setPaths] = useState<Record<string, string> | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [warnings, setWarnings] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);
	const [savedFlash, setSavedFlash] = useState(false);
	const [checking, setChecking] = useState(false);
	const [checkResult, setCheckResult] = useState<KbRefreshResult | null>(null);
	const [checkError, setCheckError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void refreshKbs();
		(async () => {
			try {
				const raw = await api.getKbConfig();
				if (cancelled) return;
				const cfg = normalizeConfig(raw);
				setConfig(cfg);
				setLoaded(cfg);
				setPaths(raw.paths ?? null);
			} catch (err) {
				if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [refreshKbs]);

	// A previous check result no longer applies once the form is edited.
	useEffect(() => {
		if (config && loaded && JSON.stringify(config) !== JSON.stringify(loaded)) {
			setCheckResult(null);
			setCheckError(null);
		}
	}, [config, loaded]);

	if (loadError) {
		return (
			<section className="flex flex-col gap-2 border-t border-border pt-4">
				<SectionTitle>{t("rag.title")}</SectionTitle>
				<p className="text-[12px] text-red-400">
					{t("rag.loadError")}: {loadError}
				</p>
			</section>
		);
	}
	if (!config) {
		return (
			<section className="flex flex-col gap-2 border-t border-border pt-4">
				<SectionTitle>{t("rag.title")}</SectionTitle>
				<p className="text-[12px] text-dim">{t("kb.loading")}</p>
			</section>
		);
	}

	const online = kbService?.online ?? false;
	const ingestRunning = kbService?.health?.ingest_running ?? false;
	const invalidRegex = config.parser.heading_patterns.some((p) => !isValidRegex(p.regex));
	const dirty = loaded !== null && JSON.stringify(config) !== JSON.stringify(loaded);

	const save = async () => {
		if (!config || invalidRegex || !online || ingestRunning) return;
		setBusy(true);
		setSaveError(null);
		setWarnings([]);
		setSavedFlash(false);
		try {
			const res = await api.updateKbConfig(config);
			setWarnings(res.warnings ?? []);
			setLoaded(config);
			setSavedFlash(true);
			window.setTimeout(() => setSavedFlash(false), 4000);
		} catch (err) {
			setSaveError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	const setParser = (patch: Partial<RagConfig["parser"]>) =>
		setConfig((prev) => (prev ? { ...prev, parser: { ...prev.parser, ...patch } } : prev));
	const setChunker = (patch: Partial<RagConfig["chunker"]>) =>
		setConfig((prev) => (prev ? { ...prev, chunker: { ...prev.chunker, ...patch } } : prev));
	const setEmbedder = (patch: Partial<RagConfig["embedder"]>) =>
		setConfig((prev) => (prev ? { ...prev, embedder: { ...prev.embedder, ...patch } } : prev));
	const setStore = (patch: Partial<RagConfig["store"]>) =>
		setConfig((prev) => (prev ? { ...prev, store: { ...prev.store, ...patch } } : prev));
	const setRetriever = (patch: Partial<RagConfig["retriever"]>) =>
		setConfig((prev) => (prev ? { ...prev, retriever: { ...prev.retriever, ...patch } } : prev));
	const setReranker = (patch: Partial<RagConfig["reranker"]>) =>
		setConfig((prev) => (prev ? { ...prev, reranker: { ...prev.reranker, ...patch } } : prev));

	const saveDisabled = busy || !dirty || !online || ingestRunning || invalidRegex;

	const checkUpdates = async () => {
		if (!kbActiveId || checking || !online || ingestRunning || dirty) return;
		setChecking(true);
		setCheckError(null);
		setCheckResult(null);
		try {
			setCheckResult(await api.refreshKb(kbActiveId));
		} catch (err) {
			setCheckError(err instanceof Error ? err.message : String(err));
		} finally {
			setChecking(false);
		}
	};

	const checkDisabled = checking || !online || ingestRunning || dirty || !kbActiveId;
	const checkTitle = !online
		? t("rag.offline")
		: ingestRunning
			? t("rag.ingestRunning")
			: !kbActiveId
				? t("kb.refresh.needActive")
				: dirty
					? t("kb.refresh.saveFirst")
					: undefined;

	return (
		<section className="flex flex-col gap-3 border-t border-border pt-4">
			<div className="flex items-center gap-2">
				<SectionTitle>{t("rag.title")}</SectionTitle>
				{!online && (
					<span className="rounded-[3px] border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 font-mono text-[9.5px] text-red-400">
						{t("rag.offline")}
					</span>
				)}
				{online && ingestRunning && (
					<span className="rounded-[3px] border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9.5px] text-amber-500">
						{t("rag.ingestRunning")}
					</span>
				)}
			</div>
			<p className="text-[12px] leading-relaxed text-dim">{t("rag.hint")}</p>

			{/* dry-run update check */}
			<div className="flex flex-col gap-1.5">
				<button
					type="button"
					onClick={() => void checkUpdates()}
					disabled={checkDisabled}
					title={checkTitle}
					className="flex w-fit items-center gap-1.5 rounded-[4px] border border-border px-2.5 py-1.5 text-[12px] text-muted hover:border-accent hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
				>
					<RefreshIcon size={12} />
					{checking ? t("kb.refresh.checking") : t("kb.refresh.button")}
				</button>
				<p className="text-[11px] leading-relaxed text-dim">{t("kb.refresh.hint")}</p>
				{checkError && (
					<p className="text-[11.5px] text-red-400">{t("kb.refresh.error", { message: checkError })}</p>
				)}
				{checkResult &&
					(checkResult.up_to_date ? (
						<p className="text-[11.5px] text-emerald-500">
							{t("kb.refresh.upToDate", { n: checkResult.files_reused })}
						</p>
					) : (
						<div className="flex flex-col gap-0.5 rounded-[4px] border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11.5px] leading-relaxed text-amber-500">
							<span>
								{t("kb.refresh.outdated", {
									details: [
										!checkResult.index_ready ? t("kb.refresh.indexMissing") : "",
										checkResult.files_added.length > 0
											? t("kb.refresh.addedCount", { n: checkResult.files_added.length })
											: "",
										checkResult.files_removed.length > 0
											? t("kb.refresh.removedCount", { n: checkResult.files_removed.length })
											: "",
										checkResult.params_changed ? t("kb.refresh.paramsChanged") : "",
									]
										.filter(Boolean)
										.join(" · "),
								})}
							</span>
							<span>{t("kb.refresh.action")}</span>
						</div>
					))}
			</div>

			{/* parser */}
			<div className="flex flex-col gap-2 rounded-[4px] border border-border bg-panel/50 p-3">
				<SectionTitle>{t("rag.parser")}</SectionTitle>
				<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
					<Toggle checked={config.parser.ocr} onChange={(v) => setParser({ ocr: v })} label={t("rag.ocr")} />
					<Toggle
						checked={config.parser.skip_toc}
						onChange={(v) => setParser({ skip_toc: v })}
						label={t("rag.skipToc")}
					/>
					<Field label={t("rag.tableMode")}>
						<Segmented
							value={config.parser.table_mode}
							options={["fast", "accurate"]}
							onChange={(v) => setParser({ table_mode: v })}
						/>
					</Field>
					<Field label={t("rag.device")}>
						<Segmented
							value={config.parser.device}
							options={["cpu", "cuda"]}
							onChange={(v) => setParser({ device: v })}
						/>
					</Field>
				</div>
				<div className="flex flex-col gap-1.5">
					<span className="text-[11.5px] text-dim">{t("rag.headingPatterns")}</span>
					{config.parser.heading_patterns.map((pattern, i) => {
						const valid = isValidRegex(pattern.regex);
						return (
							<div key={i} className="flex items-center gap-1.5">
								<input
									value={pattern.regex}
									onChange={(e) => {
										const regex = e.target.value;
										setParser({
											heading_patterns: config.parser.heading_patterns.map((p, j) =>
												j === i ? { ...p, regex } : p,
											),
										});
									}}
									className={clsx(inputClass, "font-mono", !valid && "border-red-500/60")}
									spellCheck={false}
								/>
								<input
									type="number"
									value={pattern.level}
									min={1}
									max={6}
									onChange={(e) => {
										const v = Number(e.target.value);
										if (!Number.isFinite(v)) return;
										setParser({
											heading_patterns: config.parser.heading_patterns.map((p, j) =>
												j === i ? { ...p, level: Math.floor(v) } : p,
											),
										});
									}}
									title={t("rag.level")}
									className={clsx(inputClass, "w-16 shrink-0 text-center")}
								/>
								<button
									type="button"
									onClick={() =>
										setParser({
											heading_patterns: config.parser.heading_patterns.filter((_, j) => j !== i),
										})
									}
									title={t("kb.delete")}
									className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[3px] text-muted hover:bg-btn-hover hover:text-red-400"
								>
									<TrashIcon size={11} />
								</button>
							</div>
						);
					})}
					{invalidRegex && <p className="text-[11px] text-red-400">{t("rag.invalidRegex")}</p>}
					<button
						type="button"
						onClick={() => setParser({ heading_patterns: [...config.parser.heading_patterns, { regex: "", level: 1 }] })}
						className="flex w-fit items-center gap-1 rounded-[4px] border border-border px-2 py-1 text-[11.5px] text-muted hover:border-accent hover:text-text"
					>
						<PlusIcon size={12} />
						{t("rag.addPattern")}
					</button>
				</div>
				<p className="text-[11px] leading-relaxed text-dim">{t("rag.effectiveHint")}</p>
			</div>

			{/* chunker */}
			<div className="flex flex-col gap-2 rounded-[4px] border border-border bg-panel/50 p-3">
				<SectionTitle>{t("rag.chunker")}</SectionTitle>
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
					<NumberField
						label={t("kb.chunkSize")}
						value={config.chunker.chunk_size}
						min={50}
						max={4000}
						onChange={(v) => setChunker({ chunk_size: v })}
					/>
					<NumberField
						label={t("kb.chunkOverlap")}
						value={config.chunker.chunk_overlap}
						min={0}
						max={1000}
						onChange={(v) => setChunker({ chunk_overlap: v })}
					/>
				</div>
				<p className="text-[11px] leading-relaxed text-dim">{t("rag.effectiveHint")}</p>
			</div>

			{/* embedder */}
			<div className="flex flex-col gap-2 rounded-[4px] border border-border bg-panel/50 p-3">
				<SectionTitle>{t("rag.embedder")}</SectionTitle>
				<TextField
					label={t("rag.model")}
					value={config.embedder.model_name}
					onChange={(v) => setEmbedder({ model_name: v })}
				/>
				<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
					<Field label={t("rag.device")}>
						<Segmented
							value={config.embedder.device}
							options={["auto", "cpu", "cuda"]}
							onChange={(v) => setEmbedder({ device: v })}
						/>
					</Field>
					<Field label={t("rag.dtype")}>
						<Segmented
							value={config.embedder.dtype}
							options={["bfloat16", "float16"]}
							onChange={(v) => setEmbedder({ dtype: v })}
						/>
					</Field>
				</div>
				<p className="text-[11px] leading-relaxed text-dim">{t("rag.dtypeHint")}</p>
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
					<NumberField
						label={t("rag.batchSize")}
						value={config.embedder.batch_size}
						min={1}
						max={1024}
						onChange={(v) => setEmbedder({ batch_size: v })}
					/>
					<NumberField
						label={t("rag.compressionRatio")}
						value={config.embedder.compression_ratio}
						min={0.3}
						max={0.8}
						step={0.05}
						onChange={(v) => setEmbedder({ compression_ratio: v })}
					/>
				</div>
				<p className="text-[11px] leading-relaxed text-dim">{t("rag.needsReingest")}</p>
			</div>

			{/* store */}
			<div className="flex flex-col gap-2 rounded-[4px] border border-border bg-panel/50 p-3">
				<SectionTitle>{t("rag.store")}</SectionTitle>
				<Field label={t("rag.distance")}>
					<Segmented
						value={config.store.distance_strategy}
						options={["MAX_INNER_PRODUCT", "COSINE", "EUCLIDEAN_DISTANCE"]}
						onChange={(v) => setStore({ distance_strategy: v })}
					/>
				</Field>
			</div>

			{/* retriever */}
			<div className="flex flex-col gap-2 rounded-[4px] border border-border bg-panel/50 p-3">
				<SectionTitle>{t("rag.retriever")}</SectionTitle>
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
					<NumberField
						label={t("kb.denseTopK")}
						value={config.retriever.dense_top_k}
						min={1}
						max={100}
						onChange={(v) => setRetriever({ dense_top_k: v })}
					/>
					<NumberField
						label={t("kb.sparseTopK")}
						value={config.retriever.sparse_top_k}
						min={1}
						max={100}
						onChange={(v) => setRetriever({ sparse_top_k: v })}
					/>
					<NumberField
						label={t("rag.rrfK")}
						value={config.retriever.rrf_k}
						min={1}
						max={1000}
						onChange={(v) => setRetriever({ rrf_k: v })}
					/>
				</div>
			</div>

			{/* reranker */}
			<div className="flex flex-col gap-2 rounded-[4px] border border-border bg-panel/50 p-3">
				<SectionTitle>{t("rag.reranker")}</SectionTitle>
				<TextField
					label={t("rag.model")}
					value={config.reranker.model_name}
					onChange={(v) => setReranker({ model_name: v })}
				/>
				<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
					<Field label={t("rag.device")}>
						<Segmented
							value={config.reranker.device}
							options={["auto", "cpu", "cuda"]}
							onChange={(v) => setReranker({ device: v })}
						/>
					</Field>
					<NumberField
						label={t("kb.topK")}
						value={config.reranker.top_k}
						min={1}
						max={50}
						onChange={(v) => setReranker({ top_k: v })}
					/>
				</div>
			</div>

			{/* server (read-only) + paths */}
			<div className="flex flex-col gap-2 rounded-[4px] border border-border bg-panel/50 p-3 opacity-80">
				<SectionTitle>
					{t("rag.server")} 路 {t("rag.readonly")}
				</SectionTitle>
				<div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px] text-dim">
					<span>host: {config.server.host}</span>
					<span>port: {config.server.port}</span>
					<span>warmup: {String(config.server.warmup)}</span>
					<span>cors: {config.server.cors_origins.join(", ")}</span>
				</div>
				{paths && (
					<div className="flex flex-col gap-0.5 font-mono text-[10.5px] leading-relaxed text-dim">
						<span className="truncate" title={paths.data_dir}>
							data: {paths.data_dir}
						</span>
						<span className="truncate" title={paths.index_dir}>
							index: {paths.index_dir}
						</span>
					</div>
				)}
			</div>

			{/* save row */}
			{saveError && (
				<p className="text-[12px] text-red-400">
					{t("rag.saveError", { message: saveError })}
				</p>
			)}
			{warnings.length > 0 && (
				<ul className="flex flex-col gap-0.5 rounded-[4px] border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11.5px] leading-relaxed text-amber-500">
					{warnings.map((w, i) => (
						<li key={i}>{w}</li>
					))}
				</ul>
			)}
			<div className="flex items-center justify-end gap-2">
				{savedFlash && <span className="text-[12px] text-emerald-500">{t("kb.saved")}</span>}
				<button
					type="button"
					onClick={() => void save()}
					disabled={saveDisabled}
					title={!online ? t("rag.offline") : ingestRunning ? t("rag.ingestRunning") : undefined}
					className="rounded-[4px] bg-btn-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-contrast hover:bg-btn-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
				>
					{busy ? t("rag.saving") : t("kb.save")}
				</button>
			</div>
		</section>
	);
}
