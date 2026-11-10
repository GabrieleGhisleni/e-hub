/**
 * Small transforms on the notes HTML produced at build time (already sanitized: raw HTML in the Markdown is
 * escaped, so the only tags present are the ones `marked` generates). Pure, unit-tested in test/web.
 */

const HEADING_TAG = /<(\/?)h([1-6])(?=[\s>])/g;

/**
 * Re-levels headings so the notes fit under the page outline (h1 = book title, h2 = section): the highest
 * heading present becomes `topLevel` (h3), the others keep their relative depth, capped at h6. Notes written
 * with `#` or with `##` as their top level both start at h3. Headings are never promoted.
 */
export function demoteHeadings(html: string, topLevel = 3): string {
  let min = 7;
  for (const match of html.matchAll(HEADING_TAG)) min = Math.min(min, Number(match[2]));
  if (min === 7) return html;
  const shift = Math.max(0, topLevel - min);
  if (shift === 0) return html;
  return html.replace(HEADING_TAG, (_match, slash: string, level: string) => {
    return `<${slash}h${Math.min(6, Number(level) + shift)}`;
  });
}
