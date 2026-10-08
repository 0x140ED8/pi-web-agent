import { useMemo, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";
import { MermaidBlock } from "./MermaidBlock";

const remarkPlugins: PluggableList = [remarkGfm, remarkMath];
const rehypePlugins: PluggableList = [rehypeKatex, [rehypeHighlight, { detect: false, ignoreMissing: true }]];

export function MarkdownBody({ children, isStreaming }: { children: string; isStreaming?: boolean }) {
	const components = useMemo<Components>(
		() => ({
			code(props: ComponentPropsWithoutRef<"code"> & { node?: unknown }) {
				const { node, className, children, ...rest } = props;
				void node;
				const lang = /language-([\w-]+)/.exec(className ?? "")?.[1]?.toLowerCase() ?? "";
				const raw = String(children ?? "");
				const isBlock = (className ?? "").includes("language-") || raw.includes("\n");
				if (isBlock && lang === "mermaid") {
					return <MermaidBlock code={raw.replace(/\n$/, "")} />;
				}
				return (
					<code className={className} {...rest}>
						{children}
					</code>
				);
			},
			pre({ children }) {
				return <>{children}</>;
			},
			a(props: ComponentPropsWithoutRef<"a"> & { node?: unknown }) {
				const { node, href, children } = props;
				void node;
				return (
					<a href={href} target="_blank" rel="noopener noreferrer">
						{children}
					</a>
				);
			},
			table({ children }) {
				return (
					<div className="markdown-table-wrap">
						<table>{children}</table>
					</div>
				);
			},
		}),
		[],
	);

	return (
		<div className={["markdown-body", isStreaming ? "is-streaming" : ""].filter(Boolean).join(" ")}>
			<ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
				{children}
			</ReactMarkdown>
		</div>
	);
}
