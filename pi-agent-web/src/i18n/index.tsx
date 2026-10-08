import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en } from "./en";
import { zhCN, type MessageKey, type Messages } from "./zh-CN";

export type Lang = "zh-CN" | "en";

const STORAGE_KEY = "pi-agent-web:lang";
const CATALOG: Record<Lang, Messages> = { "zh-CN": zhCN, en };

interface I18nValue {
	lang: Lang;
	setLang: (lang: Lang) => void;
	t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function detectLang(): Lang {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === "zh-CN" || stored === "en") return stored;
	} catch {
		/* ignore */
	}
	return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("zh")
		? "zh-CN"
		: "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
	const [lang, setLangState] = useState<Lang>(detectLang);

	useEffect(() => {
		document.documentElement.lang = lang;
		try {
			localStorage.setItem(STORAGE_KEY, lang);
		} catch {
			/* ignore */
		}
	}, [lang]);

	const setLang = useCallback((next: Lang) => setLangState(next), []);

	const t = useCallback(
		(key: MessageKey, vars?: Record<string, string | number>) => {
			let text: string = CATALOG[lang][key] ?? key;
			if (vars) {
				for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, String(v));
			}
			return text;
		},
		[lang],
	);

	const value = useMemo<I18nValue>(() => ({ lang, setLang, t }), [lang, setLang, t]);
	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
	const ctx = useContext(I18nContext);
	if (!ctx) throw new Error("useI18n must be used within I18nProvider");
	return ctx;
}

export type { MessageKey };
