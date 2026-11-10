import { coverPath, writeFileAtomic } from "../repo/index.ts";
import sharp from "sharp";

export const COVER_WIDTH = 600;
export const COVER_QUALITY = 78;

/**
 * Normalizes any cover image to WebP: EXIF-rotated, width 600 at most (never upscaled), metadata stripped.
 * Quality 78 + effort 5 puts typical 600x900 covers at roughly 30-60 KB.
 */
export async function toCoverWebp(input: Uint8Array): Promise<Uint8Array> {
  const out = await sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: COVER_WIDTH, withoutEnlargement: true })
    .webp({ quality: COVER_QUALITY, effort: 5 })
    .toBuffer();
  return new Uint8Array(out);
}

export function escapeXml(text: string): string {
  return (
    text
      // oxlint-disable-next-line no-control-regex -- strip chars that are invalid in XML 1.0
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
  );
}

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Greedy word wrap by character count; long words are hard-split. Returns at most `maxLines` lines. */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  const push = () => {
    if (current) lines.push(current);
    current = "";
  };
  for (let word of words) {
    while ([...word].length > maxChars) {
      const chars = [...word];
      push();
      lines.push(chars.slice(0, maxChars).join(""));
      word = chars.slice(maxChars).join("");
    }
    if (!current) current = word;
    else if ([...current].length + 1 + [...word].length <= maxChars) current += ` ${word}`;
    else {
      push();
      current = word;
    }
  }
  push();
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]!.replace(/[\s.,;:]+$/, "")}…`;
    return kept;
  }
  return lines;
}

export interface PlaceholderInput {
  title: string;
  author?: string;
}

export function placeholderSvg({ title, author }: PlaceholderInput): string {
  const hue = hashString(title) % 360;
  const bg = `hsl(${hue} 32% 30%)`;
  const bg2 = `hsl(${(hue + 24) % 360} 36% 20%)`;
  const accent = `hsl(${hue} 45% 78%)`;
  const cleanTitle = title.replace(/\s+/g, " ").trim() || "Senza titolo";
  const len = [...cleanTitle].length;
  const fontSize = len > 90 ? 38 : len > 50 ? 46 : 58;
  const maxChars = Math.floor(470 / (fontSize * 0.52));
  const lines = wrapText(cleanTitle, maxChars, 7);
  const lineHeight = Math.round(fontSize * 1.22);
  const blockHeight = lines.length * lineHeight;
  const startY = Math.max(130, 400 - blockHeight / 2) + fontSize * 0.8;
  const titleSvg = lines
    .map(
      (line, i) =>
        `<text x="300" y="${startY + i * lineHeight}" text-anchor="middle" font-size="${fontSize}" fill="#faf7f2">${escapeXml(line)}</text>`,
    )
    .join("");
  const authorLines = author?.trim() ? wrapText(author.trim(), 28, 2) : [];
  const authorSvg = authorLines
    .map(
      (line, i) =>
        `<text x="300" y="${770 + i * 38}" text-anchor="middle" font-size="30" font-style="italic" fill="${accent}">${escapeXml(line)}</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs>
<rect width="600" height="900" fill="url(#g)"/>
<rect x="28" y="28" width="544" height="844" fill="none" stroke="${accent}" stroke-opacity="0.55" stroke-width="2"/>
<g font-family="Georgia, 'DejaVu Serif', 'Liberation Serif', 'Times New Roman', serif">
<rect x="270" y="96" width="60" height="3" fill="${accent}"/>
${titleSvg}
<rect x="270" y="728" width="60" height="3" fill="${accent}"/>
${authorSvg}
</g>
</svg>`;
}

/** 600x900 typographic placeholder (system serif fonts only, no network). */
export async function placeholderCover(input: PlaceholderInput): Promise<Uint8Array> {
  const out = await sharp(Buffer.from(placeholderSvg(input)))
    .webp({ quality: COVER_QUALITY })
    .toBuffer();
  return new Uint8Array(out);
}

/** Writes `data/books/<id>/cover.webp` atomically. */
export async function saveCover(dataDir: string, id: string, webp: Uint8Array): Promise<string> {
  const file = coverPath(dataDir, id);
  await writeFileAtomic(file, webp);
  return file;
}
