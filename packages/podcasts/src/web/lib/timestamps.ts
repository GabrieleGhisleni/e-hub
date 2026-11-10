/**
 * Timestamps in notes (DESIGN.md §8.4): `[HH:MM:SS]` / `[MM:SS]` become links
 * to the YouTube video at that second **only** when the transcript's
 * timestamps are measured on the YouTube audio (`transcriptTimebase:
 * "youtube"`) and the episode has a `youtubeId`. Otherwise they stay text.
 */
import type { Episode } from "@core/schema";

/** `[1:02:03]`, `[01:02:03]`, `[2:03]`, `[62:03]`. */
const TIMESTAMP_SOURCE = String.raw`\[(?:(\d{1,2}):(\d{2}):(\d{2})|(\d{1,3}):(\d{2}))\]`;

export function timestampPattern(): RegExp {
  return new RegExp(TIMESTAMP_SOURCE, "g");
}

/** Seconds for a bracketed timestamp, or `undefined` if it is not a valid one. */
export function parseTimestamp(text: string): number | undefined {
  const match = new RegExp(`^${TIMESTAMP_SOURCE}$`).exec(text.trim());
  if (!match) return undefined;
  const [, hours, minutes, seconds, shortMinutes, shortSeconds] = match;
  if (hours !== undefined) {
    const m = Number(minutes);
    const s = Number(seconds);
    return m < 60 && s < 60 ? Number(hours) * 3600 + m * 60 + s : undefined;
  }
  const s = Number(shortSeconds);
  return s < 60 ? Number(shortMinutes) * 60 + s : undefined;
}

export function youtubeWatchUrl(youtubeId: string, seconds?: number): string {
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`;
  return seconds === undefined ? url : `${url}&t=${seconds}s`;
}

/** The video id timestamps may link to, or `undefined` when they must stay plain text. */
export function timestampVideoId(
  episode: Pick<Episode, "youtubeId" | "transcriptTimebase">,
): string | undefined {
  return episode.transcriptTimebase === "youtube" && episode.youtubeId
    ? episode.youtubeId
    : undefined;
}

// ---------------------------------------------------------------------------
// Minimal mdast shapes (the full types are a transitive dependency only).

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

/** Node types whose text must never be rewritten. */
const SKIP_INSIDE = new Set(["link", "linkReference", "definition", "code", "inlineCode"]);

/**
 * Replaces matches of `pattern` inside text nodes (not inside links or code)
 * with the nodes `replace` returns (`undefined` keeps the match as text).
 */
function rewriteText(
  tree: MdNode,
  pattern: () => RegExp,
  replace: (match: RegExpExecArray) => MdNode | undefined,
): void {
  const visit = (node: MdNode) => {
    if (!node.children || SKIP_INSIDE.has(node.type)) return;
    const children: MdNode[] = [];
    for (const child of node.children) {
      if (child.type !== "text" || !child.value) {
        visit(child);
        children.push(child);
        continue;
      }
      const text = child.value;
      const regex = pattern();
      let last = 0;
      for (let match = regex.exec(text); match; match = regex.exec(text)) {
        const replacement = replace(match);
        if (!replacement) continue;
        if (match.index > last)
          children.push({ type: "text", value: text.slice(last, match.index) });
        children.push(replacement);
        last = match.index + match[0].length;
      }
      if (last === 0) children.push(child);
      else if (last < text.length) children.push({ type: "text", value: text.slice(last) });
    }
    node.children = children;
  };
  visit(tree);
}

/** Remark plugin: links timestamps to `youtubeId` (no-op without one). */
export function remarkTimestampLinks(options: { youtubeId?: string } = {}) {
  const { youtubeId } = options;
  return (tree: object) => {
    if (!youtubeId) return;
    rewriteText(tree as MdNode, timestampPattern, (match) => {
      const seconds = parseTimestamp(match[0]);
      if (seconds === undefined) return undefined;
      return {
        type: "link",
        url: youtubeWatchUrl(youtubeId, seconds),
        title: "Apri il video a questo punto",
        children: [{ type: "text", value: match[0] }],
        data: { hProperties: { className: ["timestamp-link"] } },
      };
    });
  };
}

/** Remark plugin: wraps a fixed placeholder (e.g. the transcript-redaction marker) in a styled span. */
export function remarkMarkPlaceholder(options: { text: string; className: string }) {
  const escaped = options.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (tree: object) => {
    rewriteText(
      tree as MdNode,
      () => new RegExp(escaped, "g"),
      (match) => ({
        type: "emphasis",
        children: [{ type: "text", value: match[0] }],
        data: { hName: "span", hProperties: { className: [options.className] } },
      }),
    );
  };
}
