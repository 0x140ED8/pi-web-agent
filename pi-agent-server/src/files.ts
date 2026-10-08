import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./config.js";

/**
 * Workspace file index backing the chat input's @ mention autocomplete.
 * A breadth-first walk keeps shallow files first and skips the heavy generated
 * directories (node_modules, build output, VCS) that no one wants to mention.
 */

const IGNORED_NAMES = new Set([
	"node_modules",
	".git",
	".next",
	"dist",
	"build",
	"out",
	"__pycache__",
	".turbo",
	".cache",
	"coverage",
	".pytest_cache",
	".mypy_cache",
	".venv",
	"venv",
	"target",
	"vendor",
	".DS_Store",
]);

const IGNORED_SUFFIXES = [".pyc"];

/** Cap returned to the client (the @ menu only needs a local filter source). */
const MAX_FILES = 5000;
/** Hard cap on the walk so a pathological tree cannot block the event loop. */
const WALK_HARD_CAP = 20_000;
const MAX_WALK_DEPTH = 8;
const CACHE_TTL_MS = 10_000;

export interface WorkspaceFiles {
	workspace: string;
	/** Paths relative to the workspace, "/"-separated. */
	files: string[];
	/** True when the listing was capped. */
	truncated: boolean;
}

interface Listing {
	files: string[];
	hardTruncated: boolean;
	expiresAt: number;
}

let cache: Listing | null = null;

function walk(root: string): { files: string[]; hardTruncated: boolean } {
	const files: string[] = [];
	const queue: Array<{ abs: string; rel: string; depth: number }> = [{ abs: root, rel: "", depth: 0 }];
	while (queue.length > 0) {
		const { abs, rel, depth } = queue.shift()!;
		let dirents: fs.Dirent[];
		try {
			dirents = fs.readdirSync(abs, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const d of dirents) {
			if (IGNORED_NAMES.has(d.name) || IGNORED_SUFFIXES.some((suffix) => d.name.endsWith(suffix))) continue;
			const childRel = rel ? `${rel}/${d.name}` : d.name;
			if (d.isDirectory()) {
				if (depth + 1 <= MAX_WALK_DEPTH) queue.push({ abs: path.join(abs, d.name), rel: childRel, depth: depth + 1 });
			} else if (d.isFile()) {
				if (files.length >= WALK_HARD_CAP) return { files, hardTruncated: true };
				files.push(childRel);
			}
		}
	}
	return { files, hardTruncated: false };
}

export function listWorkspaceFiles(): WorkspaceFiles {
	const now = Date.now();
	if (!cache || cache.expiresAt <= now) {
		const { files, hardTruncated } = walk(CONFIG.workspaceDir);
		cache = { files, hardTruncated, expiresAt: now + CACHE_TTL_MS };
	}
	return {
		workspace: CONFIG.workspaceDir,
		files: cache.files.slice(0, MAX_FILES),
		truncated: cache.hardTruncated || cache.files.length > MAX_FILES,
	};
}
