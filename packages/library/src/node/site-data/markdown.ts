import { Marked } from "marked";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const SAFE_SCHEMES = new Set(["http", "https", "mailto"]);

/**
 * Only http(s), mailto, relative URLs and #fragments are allowed. Browsers ignore ASCII control
 * characters and spaces inside/before the scheme (`java\tscript:`), so they are stripped for the check.
 * The href is emitted HTML-escaped, so entities never decode into a scheme.
 */
export function isSafeUrl(href: string): boolean {
  const compact = [...href]
    .filter((ch) => {
      const c = ch.codePointAt(0)!;
      return !(c <= 0x20 || (c >= 0x7f && c <= 0xa0) || /[\s\u200b-\u200f\ufeff]/.test(ch));
    })
    .join("");
  const match = /^([^/?#:]*):/.exec(compact);
  if (!match) return true; // relative, //host, ?query, #fragment
  return SAFE_SCHEMES.has(match[1]!.toLowerCase());
}

// Raw HTML in Markdown is escaped: the published pages never carry scripts or event handlers.
const marked = new Marked({
  gfm: true,
  async: false,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    link({ href, title, tokens }) {
      const inner = this.parser.parseInline(tokens);
      if (!isSafeUrl(href)) return inner;
      const t = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(href)}"${t}>${inner}</a>`;
    },
    image({ href, title, text }) {
      if (!isSafeUrl(href)) return escapeHtml(text);
      const t = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${t}>`;
    },
  },
});

/** Markdown (GFM) → HTML; `null` when the source is absent or blank. */
export function renderMarkdown(source: string | null): string | null {
  if (source === null || source.trim() === "") return null;
  return marked.parse(source, { async: false });
}
