import type { MessageKey } from "../i18n/zh-CN";
import type { ProviderModelConfig } from "./types";

/** Known Pi API types (from pi-ai's KnownApi union), with a localized hint. */
export interface ApiTypePreset {
	value: string;
	hintKey: MessageKey;
}

export const API_TYPES: ApiTypePreset[] = [
	{ value: "openai-completions", hintKey: "apiType.openai-completions" },
	{ value: "openai-responses", hintKey: "apiType.openai-responses" },
	{ value: "anthropic-messages", hintKey: "apiType.anthropic-messages" },
	{ value: "google-generative-ai", hintKey: "apiType.google-generative-ai" },
	{ value: "mistral-conversations", hintKey: "apiType.mistral-conversations" },
	{ value: "azure-openai-responses", hintKey: "apiType.azure-openai-responses" },
	{ value: "openai-codex-responses", hintKey: "apiType.openai-codex-responses" },
	{ value: "bedrock-converse-stream", hintKey: "apiType.bedrock-converse-stream" },
	{ value: "google-vertex", hintKey: "apiType.google-vertex" },
	{ value: "pi-messages", hintKey: "apiType.pi-messages" },
];

export interface ProviderPreset {
	key: string;
	label: string;
	id: string;
	name: string;
	baseUrl: string;
	api: string;
	models: ProviderModelConfig[];
}

function model(
	id: string,
	name: string,
	reasoning: boolean,
	contextWindow?: number,
	maxTokens?: number,
): ProviderModelConfig {
	return { id, name, reasoning, input: ["text"], contextWindow, maxTokens };
}

/**
 * Starting points for common providers. Model ids/limits mirror Pi's built-in
 * catalog where one exists; they are only defaults and stay fully editable.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
	{
		key: "deepseek",
		label: "DeepSeek",
		id: "deepseek",
		name: "DeepSeek",
		baseUrl: "https://api.deepseek.com",
		api: "openai-completions",
		models: [
			model("deepseek-v4-pro", "DeepSeek V4 Pro", true, 1000000, 384000),
			model("deepseek-v4-flash", "DeepSeek V4 Flash", true, 1000000, 384000),
		],
	},
	{
		key: "moonshotai-cn",
		label: "Moonshot Kimi (CN)",
		id: "moonshotai-cn",
		name: "Moonshot AI",
		baseUrl: "https://api.moonshot.cn/v1",
		api: "openai-completions",
		models: [
			model("kimi-k3", "Kimi K3", true, 1048576, 131072),
			model("kimi-k2.7-code", "Kimi K2.7 Code", true, 262144, 262144),
			model("kimi-k2-thinking", "Kimi K2 Thinking", true, 262144, 262144),
		],
	},
	{
		key: "zai-coding-cn",
		label: "Zhipu GLM (BigModel CN)",
		id: "zai-coding-cn",
		name: "Zhipu GLM",
		baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
		api: "openai-completions",
		models: [
			model("glm-5.3", "GLM-5.3", true, 1000000, 131072),
			model("glm-5.2", "GLM-5.2", true, 1000000, 131072),
			model("glm-5.3-flash", "GLM-5.3-Flash", true, 1000000, 131072),
		],
	},
	{
		key: "minimax-cn",
		label: "MiniMax (CN)",
		id: "minimax-cn",
		name: "MiniMax",
		baseUrl: "https://api.minimaxi.com/anthropic",
		api: "anthropic-messages",
		models: [
			model("MiniMax-M3", "MiniMax-M3", true, 1048576, 512000),
			model("MiniMax-M2.7", "MiniMax-M2.7", true, 204800, 131072),
		],
	},
	{
		key: "dashscope",
		label: "Qwen (DashScope)",
		id: "dashscope",
		name: "Qwen",
		baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		api: "openai-completions",
		models: [
			model("qwen3.7-max", "Qwen3.7 Max", false, 1000000),
			model("qwen3.6-plus", "Qwen3.6 Plus", true, 1000000),
		],
	},
	{
		key: "siliconflow",
		label: "SiliconFlow",
		id: "siliconflow",
		name: "SiliconFlow",
		baseUrl: "https://api.siliconflow.cn/v1",
		api: "openai-completions",
		models: [
			model("deepseek-ai/DeepSeek-V4-Pro", "DeepSeek V4 Pro", true, 512000),
			model("Qwen/Qwen3.6-Plus", "Qwen3.6 Plus", true, 1000000),
		],
	},
	{
		key: "openai",
		label: "OpenAI",
		id: "openai",
		name: "OpenAI",
		baseUrl: "https://api.openai.com/v1",
		api: "openai-responses",
		models: [
			model("gpt-5.5", "GPT-5.5", true, 272000, 128000),
			model("gpt-5.4-mini", "GPT-5.4 mini", true, 400000, 128000),
			model("gpt-5.3-codex", "GPT-5.3 Codex", true, 400000, 128000),
		],
	},
	{
		key: "anthropic",
		label: "Anthropic Claude",
		id: "anthropic",
		name: "Anthropic",
		baseUrl: "https://api.anthropic.com",
		api: "anthropic-messages",
		models: [
			model("claude-opus-4-8", "Claude Opus 4.8", true, 1000000, 128000),
			model("claude-sonnet-4-6", "Claude Sonnet 4.6", true, 1000000, 128000),
			model("claude-haiku-4-5", "Claude Haiku 4.5", true, 200000, 64000),
		],
	},
	{
		key: "google",
		label: "Google Gemini",
		id: "google",
		name: "Google",
		baseUrl: "https://generativelanguage.googleapis.com/v1beta",
		api: "google-generative-ai",
		models: [
			model("gemini-3.7-flash", "Gemini 3.7 Flash", true, 1048576, 65536),
			model("gemini-3.5-flash", "Gemini 3.5 Flash", true, 1048576, 65536),
			model("gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview", true, 1048576, 65536),
		],
	},
	{
		key: "openrouter",
		label: "OpenRouter",
		id: "openrouter",
		name: "OpenRouter",
		baseUrl: "https://openrouter.ai/api/v1",
		api: "openai-completions",
		models: [
			model("deepseek/deepseek-v4-pro", "DeepSeek V4 Pro", true, 1024000),
			model("z-ai/glm-5.3", "GLM-5.3", true, 1048576),
			model("moonshotai/kimi-k3", "Kimi K3", true, 1048576),
			model("openai/gpt-5.5", "GPT-5.5", true, 1050000),
		],
	},
	{
		key: "xai",
		label: "xAI Grok",
		id: "xai",
		name: "xAI",
		baseUrl: "https://api.x.ai/v1",
		api: "openai-responses",
		models: [
			model("grok-4.6", "Grok 4.6", true, 500000, 500000),
			model("grok-4.5", "Grok 4.5", true, 500000, 500000),
		],
	},
	{
		key: "groq",
		label: "Groq",
		id: "groq",
		name: "Groq",
		baseUrl: "https://api.groq.com/openai/v1",
		api: "openai-completions",
		models: [
			model("openai/gpt-oss-120b", "GPT OSS 120B", true, 131072, 65536),
			model("qwen/qwen3.8-27b", "Qwen3.8 27B", true, 131042, 16384),
			model("llama-3.3-70b-versatile", "Llama 3.3 70B", false, 131072, 32768),
		],
	},
	{
		key: "ollama",
		label: "Ollama (local)",
		id: "ollama",
		name: "Ollama",
		baseUrl: "http://localhost:11434/v1",
		api: "openai-completions",
		models: [model("qwen3.8:27b", "Qwen3.8 27B (local)", true, 131072)],
	},
];
