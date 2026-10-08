import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import * as api from "../lib/api";
import {
	buildAtInsertText,
	buildEntriesFromFiles,
	extractAtQuery,
	filterFileEntries,
	type AtQueryMatch,
	type FileIndexEntry,
} from "../lib/fileFuzzy";
import { supportsThinking, THINKING_LABEL_KEYS, thinkingOptions } from "../lib/thinking";
import type { SkillInfo, ThinkingLevel } from "../lib/types";
import { useAgent } from "../state/agent";
import {
	ChevronIcon,
	CompactIcon,
	CpuIcon,
	DatabaseIcon,
	SendIcon,
	SparkIcon,
	StopIcon,
} from "./icons";

const AT_INDEX_TTL_MS = 10_000;
const SKILL_INDEX_TTL_MS = 15_000;
const SLASH_RESULT_LIMIT = 12;

export function ChatInput() {
	const { t } = useI18n();
	const {
		activeId,
		isStreaming,
		isCompacting,
		meta,
		models,
		sendMessage,
		stop,
		switchModel,
		setThinking,
		compact,
		kbs,
		kbService,
		kbActiveId,
		kbNotice,
		settings,
		updateSettings,
	} = useAgent();

	const [value, setValue] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// ── @ file autocomplete ────────────────────────────────────────────────
	const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
	const [atMenuOpen, setAtMenuOpen] = useState(false);
	const [atActiveIndex, setAtActiveIndex] = useState(0);
	const [fileIndex, setFileIndex] = useState<FileIndexEntry[] | null>(null);
	const [atLoading, setAtLoading] = useState(false);
	const fileIndexMetaRef = useRef<{ fetchedAt: number } | null>(null);
	const fileIndexFetchingRef = useRef(false);
	const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);

	// ── / skill autocomplete ───────────────────────────────────────────────
	const [slashQuery, setSlashQuery] = useState<string | null>(null);
	const [slashMenuOpen, setSlashMenuOpen] = useState(false);
	const [slashActiveIndex, setSlashActiveIndex] = useState(0);
	const [skills, setSkills] = useState<SkillInfo[] | null>(null);
	const [slashLoading, setSlashLoading] = useState(false);
	const skillIndexMetaRef = useRef<{ fetchedAt: number } | null>(null);
	const skillIndexFetchingRef = useRef(false);
	const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);

	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
	}, [value]);

	const updateAtQuery = useCallback((text: string, cursor: number | null) => {
		const pos = cursor ?? text.length;
		setAtQuery(extractAtQuery(text.slice(0, pos)));
	}, []);

	// The slash menu only triggers when the whole text before the caret is a
	// single "/token" (no whitespace), mirroring pi's /skill:name command form.
	const updateSlashQuery = useCallback((text: string, cursor: number | null) => {
		const pos = cursor ?? text.length;
		const match = /^\/(\S*)$/.exec(text.slice(0, pos));
		setSlashQuery(match ? match[1] : null);
	}, []);

	const atMatches = useMemo(
		() => (atQuery ? filterFileEntries(fileIndex ?? [], atQuery.query) : []),
		[atQuery, fileIndex],
	);

	// Skills are matched against both the bare name and the `skill:<name>`
	// command form, so "/re", "/review" and "/skill:re" all find the same
	// skill. Disabled skills stay listed — explicit invocation is their only
	// path — and are selected with the regular `/skill:<name>` command.
	const slashMatches = useMemo(() => {
		if (slashQuery === null) return [];
		const query = slashQuery.toLowerCase();
		const scored: Array<{ skill: SkillInfo; rank: number }> = [];
		for (const skill of skills ?? []) {
			const name = skill.name.toLowerCase();
			const command = `skill:${name}`;
			const description = (skill.description ?? "").toLowerCase();
			let rank: number | null = null;
			if (!query) rank = 0;
			else if (name === query || command === query) rank = 0;
			else if (name.startsWith(query) || command.startsWith(query)) rank = 1;
			else if (name.includes(query) || command.includes(query)) rank = 2;
			else if (description.includes(query)) rank = 3;
			if (rank === null) continue;
			scored.push({ skill, rank });
		}
		scored.sort((a, b) => a.rank - b.rank || a.skill.name.localeCompare(b.skill.name));
		return scored.slice(0, SLASH_RESULT_LIMIT).map((s) => s.skill);
	}, [slashQuery, skills]);

	// Open/reset the menu whenever the @token appears or changes (Escape closes
	// it; the next keystroke re-opens it).
	const atTokenKey = atQuery === null ? null : `${atQuery.start}:${atQuery.quoted ? 1 : 0}:${atQuery.query}`;
	useEffect(() => {
		if (atTokenKey === null) {
			setAtMenuOpen(false);
			setAtActiveIndex(0);
			return;
		}
		setAtMenuOpen(true);
		setAtActiveIndex(0);
	}, [atTokenKey]);

	// Fetch the workspace index when the menu opens; the server caches it for
	// ~10s, so re-opening refreshes cheaply and typing never refetches.
	useEffect(() => {
		if (!atQuery) return;
		const meta = fileIndexMetaRef.current;
		if (meta && Date.now() - meta.fetchedAt < AT_INDEX_TTL_MS) return;
		if (fileIndexFetchingRef.current) return;
		fileIndexFetchingRef.current = true;
		setAtLoading(true);
		api
			.listWorkspaceFiles()
			.then((res) => {
				setFileIndex(buildEntriesFromFiles(res.files));
				fileIndexMetaRef.current = { fetchedAt: Date.now() };
			})
			.catch(() => {
				fileIndexMetaRef.current = null;
			})
			.finally(() => {
				fileIndexFetchingRef.current = false;
				setAtLoading(false);
			});
	}, [atQuery]);

	useEffect(() => {
		if (atActiveIndex >= atMatches.length) setAtActiveIndex(Math.max(0, atMatches.length - 1));
	}, [atMatches.length, atActiveIndex]);

	useEffect(() => {
		atItemRefs.current.length = atMatches.length;
	}, [atMatches.length]);

	useEffect(() => {
		if (!atMenuOpen) return;
		atItemRefs.current[atActiveIndex]?.scrollIntoView({ block: "nearest" });
	}, [atActiveIndex, atMenuOpen]);

	// Open/reset the skill menu whenever the "/" token appears or changes
	// (Escape closes it; the next keystroke re-opens it).
	useEffect(() => {
		if (slashQuery === null) {
			setSlashMenuOpen(false);
			setSlashActiveIndex(0);
			return;
		}
		setSlashMenuOpen(true);
		setSlashActiveIndex(0);
	}, [slashQuery]);

	// Fetch skills when the menu opens. The list is cached briefly so typing
	// never refetches and a toggle in the skills panel shows up on next open.
	useEffect(() => {
		if (slashQuery === null) return;
		const meta = skillIndexMetaRef.current;
		if (meta && Date.now() - meta.fetchedAt < SKILL_INDEX_TTL_MS) return;
		if (skillIndexFetchingRef.current) return;
		skillIndexFetchingRef.current = true;
		setSlashLoading(true);
		api
			.listSkills()
			.then((res) => {
				setSkills(res.skills);
				skillIndexMetaRef.current = { fetchedAt: Date.now() };
			})
			.catch(() => {
				skillIndexMetaRef.current = null;
			})
			.finally(() => {
				skillIndexFetchingRef.current = false;
				setSlashLoading(false);
			});
	}, [slashQuery]);

	useEffect(() => {
		if (slashActiveIndex >= slashMatches.length) setSlashActiveIndex(Math.max(0, slashMatches.length - 1));
	}, [slashMatches.length, slashActiveIndex]);

	useEffect(() => {
		slashItemRefs.current.length = slashMatches.length;
	}, [slashMatches.length]);

	useEffect(() => {
		if (!slashMenuOpen) return;
		slashItemRefs.current[slashActiveIndex]?.scrollIntoView({ block: "nearest" });
	}, [slashActiveIndex, slashMenuOpen]);

	const applyAtCompletion = useCallback(
		(entry: FileIndexEntry) => {
			if (!atQuery) return;
			const ta = textareaRef.current;
			const cursor = ta?.selectionStart ?? value.length;
			const before = value.slice(0, atQuery.start);
			let after = value.slice(cursor);
			// Completing inside a quoted token: the replacement carries its own
			// closing quote, so drop the old one right after the caret.
			if (atQuery.quoted && after.startsWith('"')) after = after.slice(1);
			const insert = buildAtInsertText(entry.path, entry.isDir, atQuery.quoted);
			const newValue = before + insert.text + after;
			const newPos = before.length + insert.cursorOffset;
			setValue(newValue);
			// Files end with a space (token closes, menu hides); directories end
			// with "/" so the menu stays open for drill-down.
			setAtQuery(extractAtQuery(newValue.slice(0, newPos)));
			requestAnimationFrame(() => {
				const el = textareaRef.current;
				if (!el) return;
				el.focus();
				el.setSelectionRange(newPos, newPos);
				el.style.height = "auto";
				el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
			});
		},
		[atQuery, value],
	);

	const applySlashCompletion = useCallback(
		(skill: SkillInfo) => {
			const ta = textareaRef.current;
			const cursor = ta?.selectionStart ?? value.length;
			const after = value.slice(cursor);
			// The command ends with a space, which closes the menu; whatever
			// followed the caret becomes the command's arguments.
			const insert = `/skill:${skill.name} `;
			setValue(insert + after);
			setSlashQuery(null);
			requestAnimationFrame(() => {
				const el = textareaRef.current;
				if (!el) return;
				el.focus();
				el.setSelectionRange(insert.length, insert.length);
				el.style.height = "auto";
				el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
			});
		},
		[value],
	);

	const canSend = Boolean(activeId) && value.trim().length > 0 && !isStreaming;

	const modelOptions = useMemo(() => {
		const groups = new Map<string, typeof models>();
		for (const m of models) {
			// Hide models whose provider has no API key configured, but always
			// keep the session's current model so the selector can display it.
			if (!m.available && `${m.provider}/${m.id}` !== meta.model) continue;
			const list = groups.get(m.provider) ?? [];
			list.push(m);
			groups.set(m.provider, list);
		}
		return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
	}, [models, meta.model]);

	const submit = () => {
		if (!canSend) return;
		const text = value;
		setValue("");
		setAtQuery(null);
		setSlashQuery(null);
		void sendMessage(text);
	};

	const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		const composing = event.nativeEvent.isComposing;
		// / skill menu — skip while composing so IME candidate navigation is
		// never intercepted.
		if (slashMenuOpen && slashQuery !== null && slashMatches.length > 0 && !composing) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setSlashActiveIndex((i) => (i + 1) % slashMatches.length);
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				setSlashActiveIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				setSlashMenuOpen(false);
				return;
			}
			if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
				event.preventDefault();
				applySlashCompletion(slashMatches[slashActiveIndex]);
				return;
			}
		}
		// @ file menu — skip while composing so IME candidate navigation is
		// never intercepted.
		if (atMenuOpen && atQuery && atMatches.length > 0 && !composing) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setAtActiveIndex((i) => (i + 1) % atMatches.length);
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				setAtActiveIndex((i) => (i - 1 + atMatches.length) % atMatches.length);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				setAtMenuOpen(false);
				return;
			}
			if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
				event.preventDefault();
				applyAtCompletion(atMatches[atActiveIndex]);
				return;
			}
		}
		if (event.key === "Enter" && !event.shiftKey && !composing) {
			event.preventDefault();
			submit();
		}
	};

	const thinkingVisible = supportsThinking(models, meta.model, meta.availableThinkingLevels);
	const thinkingLevels = useMemo(
		() => thinkingOptions(meta.availableThinkingLevels, meta.thinkingLevel),
		[meta.availableThinkingLevels, meta.thinkingLevel],
	);

	const selectorClass =
		"max-w-[200px] cursor-pointer appearance-none truncate rounded-[4px] border border-transparent bg-panel py-1 pl-1.5 pr-6 font-mono text-[11.5px] text-muted outline-none hover:border-border hover:bg-btn-hover disabled:cursor-not-allowed";

	return (
		<div className="border-t border-border bg-bg px-4 pb-4 pt-3">
			<div className="mx-auto max-w-[820px]">
				<div className="relative">
					{atMenuOpen && atQuery && (
						<div className="absolute bottom-full left-0 right-0 z-30 mb-1.5 max-h-[280px] overflow-y-auto rounded-[6px] border border-border bg-panel shadow-[var(--shadow-pop)]">
							{atLoading && !fileIndex && (
								<div className="px-3 py-2.5 text-[12px] text-dim">{t("chat.fileSearch.loading")}</div>
							)}
							{!atLoading && atMatches.length === 0 && (
								<div className="px-3 py-2.5 text-[12px] text-dim">{t("chat.fileSearch.empty")}</div>
							)}
							{atMatches.map((entry, i) => {
								const slash = entry.path.lastIndexOf("/");
								const dir = slash === -1 ? "" : entry.path.slice(0, slash + 1);
								const name = entry.path.slice(slash + 1);
								return (
									<button
										key={`${entry.isDir ? "d" : "f"}:${entry.path}`}
										type="button"
										ref={(el) => {
											atItemRefs.current[i] = el;
										}}
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => applyAtCompletion(entry)}
										className={clsx(
											"flex w-full items-center gap-1.5 px-3 py-1.5 text-left",
											i === atActiveIndex ? "bg-selected" : "hover:bg-btn-hover",
										)}
									>
										<span className="shrink-0 font-mono text-[12px] text-dim">{dir}</span>
										<span className="truncate font-mono text-[12px] text-text">
											{name}
											{entry.isDir ? "/" : ""}
										</span>
									</button>
								);
							})}
							{atMatches.length > 0 && (
								<div className="border-t border-border px-3 py-1.5 font-mono text-[10px] text-dim">
									{t("chat.fileSearch.hint")}
								</div>
							)}
						</div>
					)}

					{slashMenuOpen && slashQuery !== null && (
						<div className="absolute bottom-full left-0 right-0 z-30 mb-1.5 max-h-[280px] overflow-y-auto rounded-[6px] border border-border bg-panel shadow-[var(--shadow-pop)]">
							{slashLoading && !skills && (
								<div className="px-3 py-2.5 text-[12px] text-dim">{t("chat.skillSearch.loading")}</div>
							)}
							{!slashLoading && slashMatches.length === 0 && (
								<div className="px-3 py-2.5 text-[12px] text-dim">{t("chat.skillSearch.empty")}</div>
							)}
							{slashMatches.map((skill, i) => (
								<button
									key={skill.filePath}
									type="button"
									ref={(el) => {
										slashItemRefs.current[i] = el;
									}}
									onMouseDown={(e) => e.preventDefault()}
									onClick={() => applySlashCompletion(skill)}
									className={clsx(
										"flex w-full items-baseline gap-2 px-3 py-1.5 text-left",
										i === slashActiveIndex ? "bg-selected" : "hover:bg-btn-hover",
									)}
								>
									<span className="shrink-0 font-mono text-[12px] text-text">
										{`/skill:${skill.name}`}
									</span>
									<span className="truncate text-[11.5px] text-dim">{skill.description}</span>
								</button>
							))}
							{slashMatches.length > 0 && (
								<div className="border-t border-border px-3 py-1.5 font-mono text-[10px] text-dim">
									{t("chat.skillSearch.hint")}
								</div>
							)}
						</div>
					)}

					<div className="rounded-[6px] border border-border bg-panel transition-[border-color,box-shadow] focus-within:border-accent focus-within:shadow-[var(--shadow-pop)]">
						<div className="mx-2 mt-2 flex items-start gap-1.5 rounded-[4px] bg-input px-2 py-1.5">
							<span
								className={clsx(
									"select-none pt-px font-mono text-[14px] leading-[1.6]",
									canSend ? "text-accent" : "text-dim",
								)}
								aria-hidden
							>
								›
							</span>
							<textarea
								ref={textareaRef}
								value={value}
								onChange={(e) => {
									setValue(e.target.value);
									updateAtQuery(e.target.value, e.target.selectionStart);
									updateSlashQuery(e.target.value, e.target.selectionStart);
								}}
								onKeyDown={onKeyDown}
								onSelect={(e) => {
									const el = e.currentTarget;
									updateAtQuery(el.value, el.selectionStart);
									updateSlashQuery(el.value, el.selectionStart);
								}}
								placeholder={activeId ? t("chat.placeholder") : t("chat.noSession.subtitle")}
								disabled={!activeId}
								rows={1}
								className="composer-input block max-h-[220px] w-full resize-none bg-transparent text-[14.5px] leading-[1.6] outline-none placeholder:text-dim disabled:cursor-not-allowed"
							/>
						</div>
						<div className="flex items-center gap-2 px-2.5 pb-2.5 pt-0.5">
							<div className="flex min-w-0 items-center gap-1">
								<span className="flex h-7 w-7 items-center justify-center text-dim">
									<CpuIcon size={14} />
								</span>
								<div className="relative flex items-center">
									<select
										value={meta.model ?? ""}
										onChange={(e) => {
											const [provider, ...rest] = e.target.value.split("/");
											if (provider && rest.length) void switchModel(provider, rest.join("/"));
										}}
										disabled={!activeId}
										title={t("models.title")}
										className={selectorClass}
									>
										{modelOptions.length === 0 && (
											<option value="">
												{models.length === 0 ? t("models.noModels") : t("models.noAvailableModels")}
											</option>
										)}
										{modelOptions.map(([provider, list]) => (
											<optgroup key={provider} label={provider}>
												{list.map((m) => (
													<option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
														{m.name ?? m.id}
														{m.available ? "" : " ⚠"}
													</option>
												))}
											</optgroup>
										))}
									</select>
									<ChevronIcon size={12} className="pointer-events-none absolute right-1.5 rotate-90 text-dim" />
								</div>
							</div>

						{thinkingVisible && (
							<div className="flex items-center gap-1">
								<span className="flex h-7 w-7 items-center justify-center text-dim">
									<SparkIcon size={13} />
								</span>
								<div className="relative flex items-center">
									<select
										value={meta.thinkingLevel}
										onChange={(e) => void setThinking(e.target.value as ThinkingLevel)}
										disabled={!activeId}
										title={t("topbar.thinking")}
										className={selectorClass}
									>
										{thinkingLevels.map((lvl) => (
											<option key={lvl} value={lvl}>
												{t(THINKING_LABEL_KEYS[lvl])}
											</option>
										))}
									</select>
									<ChevronIcon size={12} className="pointer-events-none absolute right-1.5 rotate-90 text-dim" />
								</div>
							</div>
						)}

						{/* knowledge base: switch + KB selector */}
						{(() => {
							const kbOnline = Boolean(kbService?.online);
							const kbAvailable = kbOnline && kbs.length > 0;
							const effectiveEnabled = settings.kbEnabled && kbAvailable;
							const selectedId = settings.kbId ?? kbActiveId ?? kbs[0]?.id ?? "";
							const selected = kbs.find((k) => k.id === selectedId);
							return (
								<div className="flex items-center gap-1" title={!kbAvailable ? t("chat.kb.disabledHint") : selected?.name ?? t("chat.kb.noKb")}>
									<button
										type="button"
										role="switch"
										aria-checked={effectiveEnabled}
										disabled={!kbAvailable}
										onClick={() => updateSettings({ kbEnabled: !settings.kbEnabled })}
										className={clsx(
											"relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40",
											effectiveEnabled ? "border-btn-accent bg-btn-accent" : "border-border bg-hover",
										)}
									>
										<span
											className={clsx(
												"absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all",
												effectiveEnabled ? "left-[18px]" : "left-[2px]",
											)}
										/>
									</button>
									<span className="flex h-7 w-7 items-center justify-center text-dim">
										<DatabaseIcon size={13} />
									</span>
									<div className="relative flex items-center">
										<select
											value={selectedId}
											onChange={(e) => updateSettings({ kbId: e.target.value || null })}
											disabled={!kbAvailable}
											className={clsx(selectorClass, "max-w-[150px]")}
										>
											{kbs.length === 0 && <option value="">{t("chat.kb.noKb")}</option>}
											{kbs.map((k) => (
												<option key={k.id} value={k.id}>
													{k.name}
													{k.id === kbActiveId ? " ●" : ""}
												</option>
											))}
										</select>
										<ChevronIcon size={12} className="pointer-events-none absolute right-1.5 rotate-90 text-dim" />
									</div>
								</div>
							);
						})()}

						<span className="flex-1" />

							<button
								type="button"
								onClick={() => void compact()}
								disabled={!activeId || isStreaming || isCompacting}
								title={t("topbar.compact")}
								className="flex h-8 items-center gap-1 rounded-[4px] px-2 text-[12.5px] text-muted hover:bg-btn-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
							>
								<CompactIcon size={14} />
								{isCompacting ? t("topbar.compacting") : t("topbar.compact")}
							</button>

							{isStreaming ? (
								<button
									type="button"
									onClick={() => void stop()}
									className="flex h-7 items-center gap-1 rounded-[4px] bg-btn-danger px-2.5 text-[12px] font-medium text-white hover:bg-btn-danger-hover"
								>
									<StopIcon size={12} />
									{t("chat.stop")}
								</button>
							) : (
								<button
									type="button"
									onClick={submit}
									disabled={!canSend}
									className="flex h-7 items-center gap-1 rounded-[4px] bg-btn-accent px-2.5 text-[12px] font-medium text-accent-contrast enabled:hover:bg-btn-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
								>
									<SendIcon size={12} />
									{t("chat.send")}
								</button>
							)}
						</div>
					</div>
				</div>

				{kbNotice && (
					<div
						className={clsx(
							"mt-1.5 px-1 font-mono text-[10.5px]",
							kbNotice.status === "ok" ? "text-dim" : "text-amber-500",
						)}
					>
						{kbNotice.status === "ok"
							? t("chat.kb.injected", {
									n: kbNotice.hits ?? 0,
									kb: kbNotice.kbName ?? "",
									ms: kbNotice.tookMs ?? 0,
								})
							: kbNotice.status === "empty"
								? t("chat.kb.empty")
								: t("chat.kb.error", { message: kbNotice.message ?? "" })}
					</div>
				)}
			</div>
		</div>
	);
}
