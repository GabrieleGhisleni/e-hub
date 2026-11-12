/**
 * Assistant Markdown to plain text, for notes (which keep plain text).
 * Drops emphasis, headings, code fences, blockquote markers and link targets; keeps list bullets,
 * line breaks, `[mm:ss]` timestamps and "(cap. N)" references as they are.
 */
const TIMESTAMP = /^\d{1,2}:\d{2}(?::\d{2})?$/;

export function markdownToPlainText(markdown: string): string {
  let text = markdown.replace(/\r\n?/g, "\n");

  // Fence lines go, the code inside stays.
  text = text.replace(/^[ \t]*(?:```|~~~)[^\n]*(?:\n|$)/gm, "");
  // Horizontal rules.
  text = text.replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, "");
  // Headings and blockquote markers.
  text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");
  text = text.replace(/^[ \t]{0,3}>[ \t]?/gm, "");
  // Images keep their alt text; links keep their label. Timestamp links keep the brackets.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, (_match, label: string) =>
    TIMESTAMP.test(label.trim()) ? `[${label.trim()}]` : label,
  );
  // Inline code.
  text = text.replace(/`+([^`\n]+?)`+/g, "$1");
  // Bullets: `*` and `+` become `-`, so emphasis markers are unambiguous below.
  text = text.replace(/^([ \t]*)[*+][ \t]+/gm, "$1- ");
  // Emphasis and strikethrough.
  text = text.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "$1");
  text = text.replace(/__(?=\S)([\s\S]*?\S)__/g, "$1");
  text = text.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1");
  text = text.replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?![*\w])/g, "$1$2");
  text = text.replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?![\w])/g, "$1$2");
  // Backslash escapes.
  text = text.replace(/\\([\\`*_{}[\]()#+\-.!~>|])/g, "$1");

  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
