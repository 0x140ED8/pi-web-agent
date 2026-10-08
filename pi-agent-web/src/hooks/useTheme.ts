import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "pi-agent-web:theme";

function detectTheme(): Theme {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === "light" || stored === "dark") return stored;
	} catch {
		/* ignore */
	}
	return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function useTheme() {
	const [theme, setThemeState] = useState<Theme>(() => {
		const attr = document.documentElement.getAttribute("data-theme");
		if (attr === "light" || attr === "dark") return attr;
		return detectTheme();
	});

	useEffect(() => {
		document.documentElement.setAttribute("data-theme", theme);
		document.documentElement.classList.toggle("dark", theme === "dark");
		const meta = document.querySelector('meta[name="theme-color"]');
		if (meta) meta.setAttribute("content", theme === "dark" ? "#1a1a1a" : "#ffffff");
		try {
			localStorage.setItem(STORAGE_KEY, theme);
		} catch {
			/* ignore */
		}
	}, [theme]);

	const setTheme = useCallback((next: Theme) => setThemeState(next), []);
	const toggle = useCallback(() => setThemeState((prev) => (prev === "dark" ? "light" : "dark")), []);

	return { theme, setTheme, toggle };
}
