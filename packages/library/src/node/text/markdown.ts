/** XHTML → Markdown (turndown, runs in Node with its bundled DOM parser). */
import TurndownService from "turndown";

const service = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  hr: "---",
});

// The bundled types reference DOM globals that this Node-only project does not load.
function attrOf(node: unknown, name: string): string | null {
  return (node as { getAttribute(n: string): string | null }).getAttribute(name);
}

service.remove(["script", "style", "head", "title"]);

// Images carry no text: keep the alt text only.
service.addRule("image-alt", {
  filter: "img",
  replacement: (_content, node) => {
    const alt = attrOf(node, "alt")?.trim();
    return alt ? ` ${alt} ` : "";
  },
});

service.addRule("svg-drop", {
  filter: (node) => node.nodeName.toLowerCase() === "svg",
  replacement: () => "",
});

// Later rules win: the noteref rule below must stay after this one.
// Links lose their target: EPUB-internal hrefs are noise for a reader of plain text.
service.addRule("link-text", {
  filter: "a",
  replacement: (content) => content,
});

// Footnote call-outs stay recognizable (`[3]`); the footnote text itself is ordinary content elsewhere.
service.addRule("noteref", {
  filter: (node) => node.nodeName === "A" && /\bnoteref\b/.test(attrOf(node, "epub:type") ?? ""),
  replacement: (content) => {
    const label = content.replace(/\s+/g, "").replace(/^\[|\]$/g, "");
    return label ? `[${label}]` : "";
  },
});

export const SPLIT_MARKER_PREFIX = "ELIBSPLITMARK";
export const SPLIT_MARKER_SUFFIX = "ELIB";
export const splitMarker = (n: number): string =>
  `${SPLIT_MARKER_PREFIX}${n}${SPLIT_MARKER_SUFFIX}`;
const MARKER_RE = new RegExp(`^${SPLIT_MARKER_PREFIX}(\\d+)${SPLIT_MARKER_SUFFIX}$`, "m");

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** XHTML allows `<a id="x"/>`; an HTML parser reads it as an unclosed tag. */
function expandSelfClosing(html: string): string {
  return html.replace(/<([a-zA-Z][\w:-]*)(\s[^<>]*?)?\s*\/>/g, (match, tag: string, attrs = "") =>
    /^(?:br|hr|img|input|meta|link|col|area|base|embed|param|source|track|wbr)$/i.test(tag)
      ? match
      : `<${tag}${attrs}></${tag}>`,
  );
}

function bodyOf(html: string): string {
  const m = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  return m?.[1] ?? html;
}

export interface ConvertedDocument {
  /** Markdown with `ELIBSPLITMARK<n>ELIB` lines where the requested anchors were found. */
  markdown: string;
  /** Indexes (into the `anchors` argument) of the anchors found in the document. */
  found: Set<number>;
}

/** Converts one XHTML document; `anchors` are fragment ids that become split markers. */
export function htmlToMarkdown(html: string, anchors: readonly string[] = []): ConvertedDocument {
  let source = expandSelfClosing(bodyOf(html));
  const found = new Set<number>();
  anchors.forEach((fragment, index) => {
    const re = new RegExp(
      `<([a-zA-Z][\\w:-]*)\\b[^>]*?\\s(?:id|name)\\s*=\\s*(["'])${escapeRegExp(fragment)}\\2[^>]*>`,
    );
    const match = re.exec(source);
    if (!match) return;
    found.add(index);
    source = `${source.slice(0, match.index)}<p>${splitMarker(index)}</p>${source.slice(match.index)}`;
  });
  const markdown = service
    .turndown(source)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/^(\s*(?:[-*]|\d+\.))[ \t]{2,}/gm, "$1 ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { markdown, found };
}

/** Splits converted Markdown at the markers: `[head, [anchorIndex, text]...]`. */
export function splitAtMarkers(markdown: string): {
  head: string;
  parts: { anchor: number; text: string }[];
} {
  const lines = markdown.split("\n");
  let head: string[] = [];
  const parts: { anchor: number; lines: string[] }[] = [];
  for (const line of lines) {
    const m = MARKER_RE.exec(line.trim());
    if (m) parts.push({ anchor: Number(m[1]), lines: [] });
    else (parts.length > 0 ? parts[parts.length - 1]!.lines : head).push(line);
  }
  const join = (l: string[]) => l.join("\n").trim();
  return {
    head: join(head),
    parts: parts.map((p) => ({ anchor: p.anchor, text: join(p.lines) })),
  };
}

export function countWords(markdown: string): number {
  return markdown.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/** First Markdown heading of a chapter, if any. */
export function firstHeading(markdown: string): string | undefined {
  const m = /^#{1,6}\s+(.+?)\s*#*\s*$/m.exec(markdown);
  return m?.[1]?.trim() || undefined;
}
