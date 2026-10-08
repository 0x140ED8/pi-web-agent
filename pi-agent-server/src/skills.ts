import fs from "node:fs";
import path from "node:path";
import { DefaultResourceLoader, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { CONFIG } from "./config.js";

/**
 * Skill discovery + the one editable setting exposed by the web UI:
 * `disable-model-invocation` in a SKILL.md frontmatter. Discovery uses the same
 * DefaultResourceLoader the AgentSessions are built with (agentDir skills,
 * ~/.agents/skills, project .pi/skills when trusted), so the panel matches the
 * runtime view.
 */

export interface SkillInfo {
	name: string;
	description: string;
	filePath: string;
	baseDir?: string;
	source?: string;
	scope?: string;
	disableModelInvocation: boolean;
}

export class SkillError extends Error {
	constructor(
		message: string,
		public status: number,
	) {
		super(message);
		this.name = "SkillError";
	}
}

export async function listSkills(): Promise<SkillInfo[]> {
	const loader = new DefaultResourceLoader({
		cwd: CONFIG.workspaceDir,
		agentDir: CONFIG.agentDir,
	});
	await loader.reload();
	return loader.getSkills().skills.map((skill) => ({
		name: skill.name,
		description: skill.description,
		filePath: skill.filePath,
		baseDir: skill.baseDir,
		source: skill.sourceInfo?.source,
		scope: skill.sourceInfo?.scope,
		disableModelInvocation: skill.disableModelInvocation,
	}));
}

function samePath(a: string, b: string): boolean {
	return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

/**
 * Toggle `disable-model-invocation` on an already-discovered skill. The path
 * must belong to a currently loaded skill, which keeps this endpoint from
 * becoming an arbitrary file writer.
 */
export async function setSkillDisabled(filePath: string, disable: boolean): Promise<SkillInfo> {
	const skills = await listSkills();
	const target = skills.find((skill) => samePath(skill.filePath, filePath));
	if (!target) throw new SkillError("skill not found", 404);

	const content = fs.readFileSync(target.filePath, "utf8");
	const updated = setDisableModelInvocation(content, disable);
	if (updated !== content) fs.writeFileSync(target.filePath, updated, "utf8");
	return { ...target, disableModelInvocation: disable };
}

const KEY = "disable-model-invocation";
const KEY_LINE = `[ \\t]*(?:${KEY}|"${KEY}"|'${KEY}')[ \\t]*:`;
const NEWLINE = "\\r\\n|\\n|\\r";

interface FrontmatterBlock {
	openingEnd: number;
	closingStart: number;
	newline: string;
}

function findFrontmatterBlock(content: string): FrontmatterBlock | undefined {
	const opening = new RegExp(`^\\uFEFF?---[ \\t]*(${NEWLINE})`).exec(content);
	if (!opening) return undefined;

	const rest = content.slice(opening[0].length);
	const closing = new RegExp(`(^|${NEWLINE})---`).exec(rest);
	if (!closing) return undefined;

	return {
		openingEnd: opening[0].length,
		closingStart: opening[0].length + closing.index + closing[1].length,
		newline: opening[1],
	};
}

function startsWithFrontmatterFence(content: string): boolean {
	const start = content.startsWith("\uFEFF") ? 1 : 0;
	return content.startsWith("---", start);
}

/**
 * Set or remove `disable-model-invocation` with a surgical line edit that
 * preserves the rest of the YAML. Detection is by key presence, not truthiness,
 * so an explicit `false` is updated in place instead of creating a duplicate
 * key (which would make the file unparseable and drop the skill).
 */
export function setDisableModelInvocation(content: string, disable: boolean): string {
	const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
	const hasKey = Object.prototype.hasOwnProperty.call(frontmatter, KEY);
	if (!disable && !hasKey) return content;

	const block = findFrontmatterBlock(content);

	if (disable) {
		if (hasKey) {
			if (!block) throw new SkillError(`cannot edit ${KEY}: unsupported frontmatter formatting`, 422);
			const head = content.slice(block.openingEnd, block.closingStart);
			const keyLine = new RegExp(`(^|${NEWLINE})(${KEY_LINE})[^\\r\\n]*`);
			if (!keyLine.test(head)) throw new SkillError(`cannot edit ${KEY}: unsupported frontmatter formatting`, 422);
			const updated = head.replace(keyLine, "$1$2 true");
			return content.slice(0, block.openingEnd) + updated + content.slice(block.closingStart);
		}
		if (!block) {
			if (startsWithFrontmatterFence(content)) {
				throw new SkillError(`cannot edit ${KEY}: unsupported frontmatter formatting`, 422);
			}
			const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
			const body = bom ? content.slice(1) : content;
			return `${bom}---\n${KEY}: true\n---\n${body}`;
		}
		return (
			content.slice(0, block.openingEnd) + `${KEY}: true${block.newline}` + content.slice(block.openingEnd)
		);
	}

	if (!block) throw new SkillError(`cannot edit ${KEY}: unsupported frontmatter formatting`, 422);
	const head = content.slice(block.openingEnd, block.closingStart);
	const keyLine = new RegExp(`(^|${NEWLINE})${KEY_LINE}[^\\r\\n]*(?:${NEWLINE}|$)`);
	if (!keyLine.test(head)) throw new SkillError(`cannot edit ${KEY}: unsupported frontmatter formatting`, 422);
	const updated = head.replace(keyLine, "$1");
	return content.slice(0, block.openingEnd) + updated + content.slice(block.closingStart);
}
