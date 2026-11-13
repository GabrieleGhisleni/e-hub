/**
 * Note bodies are Markdown (GFM): bold, lists, headings, quotes, links. Raw HTML is not rendered (react-markdown
 * default). Single line breaks are kept, so notes written as plain text read as before. Search matches are wrapped in
 * <mark> by a small rehype step, inside the rendered text only (never inside code or URLs).
 */
import type { ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@ehub/ui";

/** Minimal hast shapes (the parts the highlight step touches). */
type HastText = { type: "text"; value: string };
type HastElement = {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
};
type HastNode = HastText | HastElement | { type: string; children?: HastNode[] };

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Rehype plugin: wraps every case-insensitive match of `tokens` in a `<mark>`, skipping code. */
function rehypeHighlight(tokens: readonly string[]) {
  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi");
  const walk = (node: HastNode): void => {
    if (!("children" in node) || !node.children) return;
    if (node.type === "element" && ((node as HastElement).tagName === "code" || (node as HastElement).tagName === "pre")) return;
    node.children = node.children.flatMap((child): HastNode[] => {
      if (child.type !== "text") {
        walk(child);
        return [child];
      }
      const parts = (child as HastText).value.split(pattern);
      if (parts.length === 1) return [child];
      return parts.flatMap((part, i): HastNode[] => {
        if (part === "") return [];
        if (i % 2 === 0) return [{ type: "text", value: part }];
        return [{ type: "element", tagName: "mark", properties: {}, children: [{ type: "text", value: part }] }];
      });
    });
  };
  return () => (tree: HastNode) => walk(tree);
}

const BLOCK_START = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>|\||```|~~~|$)/;

/**
 * Turns single line breaks inside paragraphs into Markdown hard breaks ("  \n"), so a note typed as plain text keeps
 * its lines. Lines before a block start (list item, heading, quote, table, fence, blank) and fenced code are untouched.
 */
export function preserveLineBreaks(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let fenced = false;
  return lines
    .map((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      const next = lines[i + 1];
      if (fenced || next === undefined || line.trim() === "" || /^\s*\|/.test(line)) return line;
      if (BLOCK_START.test(next) || line.endsWith("  ")) return line;
      return `${line}  `;
    })
    .join("\n");
}

/** Plain text of a Markdown note, for one-line previews (pinned strip). */
export function markdownPreview(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__|\*|_|~~|`)(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

function NoteLink({ node: _node, href, children, ...props }: ComponentProps<"a"> & { node?: unknown }) {
  const external = href !== undefined && /^https?:\/\//i.test(href);
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="break-words text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
      {...props}
    >
      {children}
    </a>
  );
}

function NoteMark({ node: _node, children }: ComponentProps<"mark"> & { node?: unknown }) {
  return (
    <mark className="rounded-[3px] bg-brand-soft px-0.5 text-foreground ring-1 ring-brand/25">{children}</mark>
  );
}

const COMPONENTS: Components = { a: NoteLink, mark: NoteMark };

/** Typography of a note: comfortable reading size, clear spacing between blocks, visible bold and headings. */
export const NOTE_PROSE = cn(
  "text-[0.9375rem] leading-7 text-foreground break-words sm:text-base",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&_p]:my-3",
  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-1 [&_li]:pl-1 [&_li>p]:my-0 [&_li::marker]:text-brand/70",
  "[&_strong]:font-semibold [&_strong]:text-foreground",
  "[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:font-serif [&_h1]:text-xl [&_h1]:font-semibold",
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:font-serif [&_h2]:text-lg [&_h2]:font-semibold",
  "[&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:font-semibold",
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-brand/60 [&_blockquote]:pl-4 [&_blockquote]:font-serif [&_blockquote]:italic [&_blockquote]:text-foreground/80",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_hr]:my-5 [&_hr]:border-border",
  "[&_table]:my-3 [&_table]:w-full [&_table]:text-sm [&_th]:border-b [&_th]:py-1 [&_th]:text-left [&_td]:border-b [&_td]:border-border/60 [&_td]:py-1",
);

export function NoteMarkdown({
  text,
  tokens = [],
  className,
}: {
  text: string;
  tokens?: readonly string[];
  className?: string;
}) {
  return (
    <div className={cn(NOTE_PROSE, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={tokens.length > 0 ? [rehypeHighlight(tokens)] : []}
        components={COMPONENTS}
      >
        {preserveLineBreaks(text)}
      </ReactMarkdown>
    </div>
  );
}
