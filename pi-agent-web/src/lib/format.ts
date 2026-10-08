export function formatTokens(n: number | undefined): string {
	if (!n || n <= 0) return "0";
	if (n < 1000) return String(n);
	if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}

export function formatCost(n: number | undefined): string {
	if (n == null || n === 0) return "$0.00";
	if (n < 0.01) return `$${n.toFixed(4)}`;
	if (n < 1) return `$${n.toFixed(3)}`;
	return `$${n.toFixed(2)}`;
}

export function toMillis(value: number | string | undefined): number | undefined {
	if (value == null) return undefined;
	if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export function formatClock(value: number | string | undefined): string {
	const ms = toMillis(value);
	if (!ms) return "";
	const d = new Date(ms);
	const pad = (x: number) => String(x).padStart(2, "0");
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function relativeTime(value: number | string | undefined, lang: "zh-CN" | "en" = "zh-CN"): string {
	const ms = toMillis(value);
	if (!ms) return "";
	const diff = Date.now() - ms;
	const min = Math.floor(diff / 60000);
	if (min < 1) return lang === "zh-CN" ? "刚刚" : "just now";
	if (min < 60) return lang === "zh-CN" ? `${min} 分钟前` : `${min}m ago`;
	const hours = Math.floor(min / 60);
	if (hours < 24) return lang === "zh-CN" ? `${hours} 小时前` : `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return lang === "zh-CN" ? `${days} 天前` : `${days}d ago`;
	return formatClock(ms);
}

/** Compact round-trip duration: `820ms` below one second, `1.24s` above. */
export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "";
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

export function truncate(text: string, max = 80): string {
	if (text.length <= max) return text;
	return text.slice(0, max - 1) + "…";
}

/** Drop the workspace prefix from a path so tool rows stay scannable. */
export function shortenPath(path: string, base?: string | null): string {
	if (!base) return path;
	const p = path.replace(/\\/g, "/");
	const b = base.replace(/\\/g, "/").replace(/\/+$/, "");
	if (b && p.toLowerCase().startsWith(`${b.toLowerCase()}/`)) return p.slice(b.length + 1);
	return path;
}
