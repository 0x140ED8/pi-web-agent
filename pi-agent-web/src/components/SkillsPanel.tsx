import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n";
import * as api from "../lib/api";
import type { SkillInfo } from "../lib/types";
import { Modal } from "./Modal";

interface SkillsPanelProps {
	open: boolean;
	onClose: () => void;
}

export function SkillsPanel({ open, onClose }: SkillsPanelProps) {
	const { t } = useI18n();
	const [skills, setSkills] = useState<SkillInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [pendingPath, setPendingPath] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const res = await api.listSkills();
			setSkills(res.skills);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (open) {
			setNotice(null);
			void load();
		}
	}, [open, load]);

	const toggle = async (skill: SkillInfo, index: number) => {
		setPendingPath(skill.filePath);
		try {
			const res = await api.setSkillDisabled(skill.filePath, !skill.disableModelInvocation);
			setSkills((prev) => prev.map((s, i) => (i === index ? res.skill : s)));
			setError(null);
			setNotice(t("skills.saved"));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setPendingPath(null);
		}
	};

	return (
		<Modal open={open} onClose={onClose} title={t("skills.title")} widthClass="max-w-2xl">
			<div className="flex flex-col gap-4">
				<p className="text-[12px] leading-relaxed text-dim">{t("skills.hint")}</p>

				{error && (
					<div className="rounded-[4px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-400">
						{error}
					</div>
				)}
				{notice && !error && (
					<div className="rounded-[4px] border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[12.5px] text-emerald-400">
						{notice}
					</div>
				)}

				{loading && skills.length === 0 && (
					<div className="py-6 text-center text-[12.5px] text-dim">{t("skills.loading")}</div>
				)}

				{!loading && skills.length === 0 && (
					<div className="rounded-[4px] border border-border bg-panel/50 px-4 py-6 text-center text-[12.5px] text-dim">
						{t("skills.empty")}
					</div>
				)}

				{skills.map((skill, index) => {
					const enabled = !skill.disableModelInvocation;
					const pending = pendingPath === skill.filePath;
					return (
						<div
							key={skill.filePath}
							className={clsx(
								"flex items-start gap-3 rounded-[4px] border border-border bg-panel/50 p-3",
								!enabled && "opacity-70",
							)}
						>
							<div className="min-w-0 flex-1">
								<div className="flex flex-wrap items-center gap-2">
									<span className="font-mono text-[12.5px] font-medium">{skill.name}</span>
									{skill.scope && (
										<span className="rounded-[3px] border border-border px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-dim">
											{skill.scope === "project" ? t("skills.scope.project") : t("skills.scope.user")}
										</span>
									)}
								</div>
								<p className="mt-1 text-[12.5px] leading-relaxed text-muted">{skill.description}</p>
								<p className="mt-1.5 truncate font-mono text-[10.5px] text-dim" title={skill.filePath}>
									{skill.filePath}
								</p>
							</div>
							<button
								type="button"
								role="switch"
								aria-checked={enabled}
								disabled={pending}
								onClick={() => void toggle(skill, index)}
								title={enabled ? t("skills.disable") : t("skills.enable")}
								className={clsx(
									"relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors disabled:cursor-wait",
									enabled ? "border-btn-accent bg-btn-accent" : "border-border bg-hover",
								)}
							>
								<span
									className={clsx(
										"absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all",
										enabled ? "left-[18px]" : "left-[2px]",
									)}
								/>
							</button>
						</div>
					);
				})}
			</div>
		</Modal>
	);
}
