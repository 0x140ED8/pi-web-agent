import type { MessageKey } from "../i18n/zh-CN";
import { THINKING_LEVELS, type ModelInfo, type ThinkingLevel } from "./types";

/** i18n keys for the short label of each thinking level. */
export const THINKING_LABEL_KEYS: Record<ThinkingLevel, MessageKey> = {
	off: "thinking.off",
	minimal: "thinking.minimal",
	low: "thinking.low",
	medium: "thinking.medium",
	high: "thinking.high",
	xhigh: "thinking.xhigh",
	max: "thinking.max",
};

/** Resolve a `provider/modelId` reference against the model list. */
export function findModel(models: ModelInfo[], ref: string | null): ModelInfo | undefined {
	if (!ref) return undefined;
	const slash = ref.indexOf("/");
	if (slash <= 0) return undefined;
	const provider = ref.slice(0, slash);
	const id = ref.slice(slash + 1);
	return models.find((m) => m.provider === provider && m.id === id);
}

/**
 * Whether the session's model supports reasoning. Unknown models fall back to
 * `true` so the selector stays reachable.
 */
export function modelSupportsReasoning(models: ModelInfo[], ref: string | null): boolean {
	const model = findModel(models, ref);
	return model ? model.reasoning !== false : true;
}

/**
 * Whether to show the thinking selector: prefer the server-reported levels for
 * the current model, fall back to the model's `reasoning` flag.
 */
export function supportsThinking(
	models: ModelInfo[],
	ref: string | null,
	availableLevels: ThinkingLevel[],
): boolean {
	if (availableLevels.length > 0) return availableLevels.some((level) => level !== "off");
	return modelSupportsReasoning(models, ref);
}

/** Options for the thinking selector: server levels (or all), plus the current one. */
export function thinkingOptions(availableLevels: ThinkingLevel[], current: ThinkingLevel): ThinkingLevel[] {
	const levels = availableLevels.length > 0 ? availableLevels : THINKING_LEVELS;
	const options = [...levels];
	if (!options.includes(current)) options.push(current);
	return options;
}
