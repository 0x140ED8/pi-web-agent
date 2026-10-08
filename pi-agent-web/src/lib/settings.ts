export interface AppSettings {
	/** Auto-generate a session title on the first user turn. */
	autoRename: boolean;
	/** System prompt used by the one-shot naming call. */
	namingPrompt: string;
	/** Inject knowledge-base context into each sent message. */
	kbEnabled: boolean;
	/** Knowledge base used for injection (null = server's active KB). */
	kbId: string | null;
}

export const DEFAULT_NAMING_PROMPT = [
	"你是会话命名助手。",
	"根据用户的第一条消息，输出一个简短、具体的会话标题。",
	"要求：不超过 12 个汉字（英文不超过 6 个单词），不带标点符号、引号、编号或任何解释，只输出标题本身。",
].join("");

export const DEFAULT_SETTINGS: AppSettings = {
	autoRename: true,
	namingPrompt: DEFAULT_NAMING_PROMPT,
	kbEnabled: false,
	kbId: null,
};

const STORAGE_KEY = "pi-agent-web:settings";

export function loadSettings(): AppSettings {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULT_SETTINGS };
		const parsed = JSON.parse(raw) as Partial<AppSettings>;
		return {
			autoRename: typeof parsed.autoRename === "boolean" ? parsed.autoRename : DEFAULT_SETTINGS.autoRename,
			namingPrompt:
				typeof parsed.namingPrompt === "string" && parsed.namingPrompt.trim()
					? parsed.namingPrompt
					: DEFAULT_SETTINGS.namingPrompt,
			kbEnabled: typeof parsed.kbEnabled === "boolean" ? parsed.kbEnabled : DEFAULT_SETTINGS.kbEnabled,
			kbId: typeof parsed.kbId === "string" && parsed.kbId ? parsed.kbId : null,
		};
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export function saveSettings(settings: AppSettings): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
	} catch {
		/* ignore */
	}
}

/** Turn a raw model reply into a clean, short session title. */
export function cleanSessionName(text: string | undefined): string {
	if (!text) return "";
	let s = text.trim().split("\n")[0]?.trim() ?? "";
	s = s.replace(/^#+\s*/, "");
	s = s.replace(/^(会话标题|标题|title)\s*[:：]\s*/i, "");
	s = s.replace(/^["'“”‘’「」『』【】\[\]()（）]+|["'“”‘’「」『』【】\[\]()（）]+$/g, "");
	s = s.replace(/[。\.!！?？,，;；]+$/, "");
	return s.slice(0, 40).trim();
}
