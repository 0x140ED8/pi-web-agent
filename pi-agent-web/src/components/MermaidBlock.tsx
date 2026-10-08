import { useEffect, useId, useRef, useState } from "react";

type MermaidApi = typeof import("mermaid").default;

let mermaidPromise: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
	if (!mermaidPromise) {
		mermaidPromise = import("mermaid").then((mod) => mod.default);
	}
	return mermaidPromise;
}

function currentMermaidTheme(): "dark" | "default" {
	return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "default";
}

/** Re-renders when the document theme attribute changes. */
function useThemeAttribute(): string {
	const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme") ?? "dark");
	useEffect(() => {
		const observer = new MutationObserver(() =>
			setTheme(document.documentElement.getAttribute("data-theme") ?? "dark"),
		);
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
		return () => observer.disconnect();
	}, []);
	return theme;
}

export function MermaidBlock({ code }: { code: string }) {
	const reactId = useId().replace(/[^a-zA-Z0-9]/g, "");
	const theme = useThemeAttribute();
	const ref = useRef<HTMLDivElement>(null);
	const [error, setError] = useState<string | null>(null);
	const [ready, setReady] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setError(null);
		setReady(false);
		void (async () => {
			try {
				const container = ref.current;
				if (!container) return;
				const mermaid = await loadMermaid();
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: "strict",
					theme: currentMermaidTheme(),
					fontFamily: "inherit",
				});
				const { svg } = await mermaid.render(`mermaid_${reactId}`, code, container);
				if (cancelled) return;
				container.innerHTML = svg;
				const svgEl = container.querySelector<SVGSVGElement>("svg");
				if (svgEl) {
					const viewBox = (svgEl.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
					const width = viewBox[2];
					const height = viewBox[3];
					if (width && height) {
						svgEl.setAttribute("width", String(width));
						svgEl.setAttribute("height", String(height));
					}
					svgEl.style.maxWidth = "none";
				}
				setReady(true);
			} catch (err) {
				if (!cancelled) setError(err instanceof Error ? err.message : String(err));
			}
		})();
		return () => {
			cancelled = true;
			if (ref.current) ref.current.innerHTML = "";
		};
	}, [code, reactId, theme]);

	if (error) {
		return (
			<div className="mermaid-block">
				<pre className="mermaid-error">{code}</pre>
			</div>
		);
	}

	return (
		<div className="mermaid-block" data-rendered={ready ? "true" : "false"}>
			{!ready && <div className="text-dim text-xs">Rendering diagram…</div>}
			<div ref={ref} />
		</div>
	);
}
