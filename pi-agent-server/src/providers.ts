import fs from "node:fs";
import path from "node:path";
import { PROVIDERS_PATH } from "./config.js";

/**
 * Provider config file management.
 *
 * `config/providers.json` is the single source of truth for providers, models
 * and API keys, written in pi's native models.json format. The file is passed
 * to ModelRuntime via `modelsPath`, so editing it (manually or through the
 * HTTP API) plus a `modelRuntime.refresh({ allowNetwork: false })` makes
 * changes take effect without restarting the server — same as pi's /model.
 */

export interface ProviderModelConfig {
	id: string;
	name?: string;
	api?: string;
	baseUrl?: string;
	reasoning?: boolean;
	input?: string[];
	contextWindow?: number;
	maxTokens?: number;
	cost?: Record<string, number>;
	compat?: Record<string, unknown>;
	[k: string]: unknown;
}

export interface ProviderUserConfig {
	name?: string;
	baseUrl: string;
	api?: string;
	apiKey?: string;
	authHeader?: boolean;
	headers?: Record<string, string>;
	compat?: Record<string, unknown>;
	models: ProviderModelConfig[];
	[k: string]: unknown;
}

export interface ProvidersFile {
	providers: Record<string, ProviderUserConfig>;
}

export function readProviders(): ProvidersFile {
	if (!fs.existsSync(PROVIDERS_PATH)) {
		return { providers: {} };
	}
	const parsed = JSON.parse(fs.readFileSync(PROVIDERS_PATH, "utf8")) as Partial<ProvidersFile>;
	if (!parsed || typeof parsed !== "object" || typeof parsed.providers !== "object" || parsed.providers === null) {
		return { providers: {} };
	}
	return { providers: parsed.providers };
}

export function writeProviders(file: ProvidersFile): void {
	fs.mkdirSync(path.dirname(PROVIDERS_PATH), { recursive: true });
	const tmp = PROVIDERS_PATH + ".tmp";
	fs.writeFileSync(tmp, JSON.stringify(file, null, "\t") + "\n", "utf8");
	fs.renameSync(tmp, PROVIDERS_PATH);
}

export function maskKey(key: string | undefined): string | undefined {
	if (typeof key !== "string" || key.length === 0) return undefined;
	if (key.startsWith("$") || key.startsWith("!")) return key; // env ref / command, not a secret literal
	if (key.length <= 8) return "***";
	return `${key.slice(0, 5)}...${key.slice(-4)}`;
}

/** Return provider config with the API key masked, for API responses. */
export function publicProvider(id: string, cfg: ProviderUserConfig): Record<string, unknown> {
	const out: Record<string, unknown> = { ...cfg };
	delete out.apiKey;
	out.hasApiKey = typeof cfg.apiKey === "string" && cfg.apiKey.length > 0;
	const masked = maskKey(cfg.apiKey);
	if (masked !== undefined) out.apiKeyMasked = masked;
	return { id, ...out };
}

/** Validate a provider config submitted via the API. Returns an error message or null. */
export function validateProviderConfig(cfg: unknown): string | null {
	if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
		return "provider config must be a JSON object";
	}
	const c = cfg as Record<string, unknown>;
	if (typeof c.baseUrl !== "string" || c.baseUrl.length === 0) {
		return "baseUrl is required";
	}
	if (!Array.isArray(c.models) || c.models.length === 0) {
		return "models must be a non-empty array";
	}
	for (const m of c.models) {
		if (!m || typeof m !== "object" || typeof (m as Record<string, unknown>).id !== "string" || (m as Record<string, unknown>).id === "") {
			return "every model must have a non-empty string id";
		}
	}
	if (c.apiKey !== undefined && typeof c.apiKey !== "string") {
		return "apiKey must be a string";
	}
	return null;
}
