import { useI18n } from "../i18n";
import type { Theme } from "../hooks/useTheme";
import { DEFAULT_NAMING_PROMPT } from "../lib/settings";
import { useAgent } from "../state/agent";
import { Modal } from "./Modal";
import { RagConfigSection } from "./RagConfigSection";

interface SettingsPanelProps {
	open: boolean;
	onClose: () => void;
	theme: Theme;
	setTheme: (theme: Theme) => void;
}

export function SettingsPanel({ open, onClose, theme, setTheme }: SettingsPanelProps) {
	const { t, lang, setLang } = useI18n();
	const { settings, updateSettings } = useAgent();

	return (
		<Modal open={open} onClose={onClose} title={t("settings.title")} widthClass="max-w-2xl">
			<div className="flex flex-col gap-5">
				<section className="flex flex-col gap-2">
					<label className="flex cursor-pointer items-center gap-3">
						<input
							type="checkbox"
							checked={settings.autoRename}
							onChange={(e) => updateSettings({ autoRename: e.target.checked })}
							className="h-4 w-4 accent-[var(--accent)]"
						/>
						<span className="text-[13.5px] font-medium">{t("settings.autoRename")}</span>
					</label>
					<p className="text-[12px] leading-relaxed text-dim">{t("settings.autoRenameHint")}</p>
				</section>

				<section className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<label className="text-[13.5px] font-medium">{t("settings.namingPrompt")}</label>
						<button
							type="button"
							onClick={() => updateSettings({ namingPrompt: DEFAULT_NAMING_PROMPT })}
							className="text-[12px] text-accent hover:underline"
						>
							{t("settings.reset")}
						</button>
					</div>
					<textarea
						value={settings.namingPrompt}
						onChange={(e) => updateSettings({ namingPrompt: e.target.value })}
						rows={4}
						disabled={!settings.autoRename}
						className="w-full resize-y rounded-[4px] border border-border bg-panel px-3 py-2 font-mono text-[12.5px] leading-relaxed outline-none focus:border-accent disabled:opacity-50"
					/>
					<p className="text-[12px] text-dim">{t("settings.namingPromptHint")}</p>
				</section>

				<section className="flex flex-col gap-3 sm:flex-row sm:gap-8">
					<div className="flex flex-col gap-1.5">
						<span className="text-[13.5px] font-medium">{t("settings.language")}</span>
						<div className="flex gap-1">
							{(["zh-CN", "en"] as const).map((l) => (
								<button
									key={l}
									type="button"
									onClick={() => setLang(l)}
									className={`rounded-[4px] border px-3 py-1 text-[12.5px] ${
										lang === l
											? "border-accent bg-accent/15 text-accent"
											: "border-border text-muted hover:bg-btn-hover"
									}`}
								>
									{l === "zh-CN" ? "中文" : "English"}
								</button>
							))}
						</div>
					</div>

					<div className="flex flex-col gap-1.5">
						<span className="text-[13.5px] font-medium">{t("settings.theme")}</span>
						<div className="flex gap-1">
							{(["light", "dark"] as const).map((th) => (
								<button
									key={th}
									type="button"
									onClick={() => setTheme(th)}
									className={`rounded-[4px] border px-3 py-1 text-[12.5px] ${
										theme === th
											? "border-accent bg-accent/15 text-accent"
											: "border-border text-muted hover:bg-btn-hover"
									}`}
								>
									{th === "light" ? t("settings.light") : t("settings.dark")}
								</button>
							))}
						</div>
					</div>
				</section>

				<RagConfigSection />
			</div>
		</Modal>
	);
}
