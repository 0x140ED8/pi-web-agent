import { useI18n } from "../i18n";
import { formatCost, formatTokens } from "../lib/format";
import { useAgent } from "../state/agent";
import type { Theme } from "../hooks/useTheme";
import { GearIcon, MoonIcon, PencilIcon, RefreshIcon, SunIcon } from "./icons";

interface TopBarProps {
	theme: Theme;
	onToggleTheme: () => void;
	onOpenSettings: () => void;
	onToggleSidebar: () => void;
}

function Readout({ label, value, title }: { label: string; value: string; title: string }) {
	return (
		<span className="flex flex-col items-end leading-none" title={title}>
			<span className="eyebrow text-[9px]">{label}</span>
			<span className="mt-1 font-mono text-[11.5px] tabular-nums text-text">{value}</span>
		</span>
	);
}

function ContextArc({ pct }: { pct: number }) {
	const r = 6.5;
	const circumference = 2 * Math.PI * r;
	const filled = (Math.min(pct, 100) / 100) * circumference;
	return (
		<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden className="shrink-0">
			<circle cx="9" cy="9" r={r} fill="none" stroke="var(--border)" strokeWidth="2" />
			<circle
				cx="9"
				cy="9"
				r={r}
				fill="none"
				stroke={pct > 85 ? "#e5484d" : "var(--accent)"}
				strokeWidth="2"
				strokeLinecap="round"
				strokeDasharray={`${filled} ${circumference}`}
				transform="rotate(-90 9 9)"
			/>
		</svg>
	);
}

export function TopBar({ theme, onToggleTheme, onOpenSettings, onToggleSidebar }: TopBarProps) {
	const { t } = useI18n();
	const { activeId, activeSession, stats, renameSession, refreshSessions } = useAgent();

	const title = activeSession?.name || activeSession?.firstMessage?.slice(0, 60) || (activeId ? activeId.slice(0, 8) : "");

	const tokensIn = stats?.tokens?.input ?? 0;
	const tokensOut = stats?.tokens?.output ?? 0;
	const cost = stats?.cost ?? 0;
	const ctx = stats?.contextUsage;
	const ctxPct =
		typeof ctx?.percentage === "number"
			? Math.round(ctx.percentage)
			: typeof ctx?.usedTokens === "number" && typeof ctx?.maxTokens === "number" && ctx.maxTokens > 0
				? Math.round((ctx.usedTokens / ctx.maxTokens) * 100)
				: undefined;

	const handleRename = () => {
		if (!activeId) return;
		const next = window.prompt(t("sessions.renamePrompt"), activeSession?.name ?? "");
		if (next && next.trim()) void renameSession(activeId, next);
	};

	const iconButton =
		"flex h-8 w-8 items-center justify-center rounded-[4px] text-muted hover:bg-btn-hover hover:text-text";

	return (
		<div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-bg px-3">
			<button
				type="button"
				onClick={onToggleSidebar}
				className="rounded-[4px] px-2 py-1 text-[12px] text-muted hover:bg-btn-hover md:hidden"
			>
				☰
			</button>

			{title ? (
				<button
					type="button"
					onClick={handleRename}
					title={t("sessions.rename")}
					className="group flex min-w-0 items-center gap-1.5 rounded-[4px] px-2 py-1 text-[13px] font-medium tracking-tight hover:bg-btn-hover"
				>
					<span className="truncate">{title}</span>
					<PencilIcon size={13} className="shrink-0 text-dim opacity-0 transition-opacity group-hover:opacity-100" />
				</button>
			) : (
				<span className="truncate px-2 text-[13px] text-dim">{t("app.title")}</span>
			)}

			<span className="flex-1" />

			{activeId && (
				<>
					<div className="hidden items-center gap-3 sm:flex">
						<Readout label={t("topbar.tokensIn")} value={formatTokens(tokensIn)} title={t("topbar.tokensIn")} />
						<span className="h-4 w-px bg-border" aria-hidden />
						<Readout
							label={t("topbar.tokensOut")}
							value={formatTokens(tokensOut)}
							title={t("topbar.tokensOut")}
						/>
						<span className="h-4 w-px bg-border" aria-hidden />
						<Readout label={t("topbar.cost")} value={formatCost(cost)} title={t("topbar.cost")} />
						{ctxPct != null && (
							<>
								<span className="h-4 w-px bg-border" aria-hidden />
								<span className="flex items-center gap-1.5" title={t("topbar.context")}>
									<ContextArc pct={ctxPct} />
									<span className="font-mono text-[11.5px] tabular-nums text-text">{ctxPct}%</span>
								</span>
							</>
						)}
					</div>
				</>
			)}

			<button type="button" onClick={() => void refreshSessions()} title={t("app.refresh")} className={iconButton}>
				<RefreshIcon size={15} />
			</button>
			<button type="button" onClick={onToggleTheme} title={t("settings.theme")} className={iconButton}>
				{theme === "dark" ? <SunIcon size={15} /> : <MoonIcon size={15} />}
			</button>
			<button type="button" onClick={onOpenSettings} title={t("app.settings")} className={iconButton}>
				<GearIcon size={15} />
			</button>
		</div>
	);
}
