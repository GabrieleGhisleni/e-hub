/**
 * Chapter segmentation. Limits (documented in the study skill):
 * - chapter boundaries come from the TOC (EPUB 3 nav, else EPUB 2 NCX), depth 1 and 2 only; deeper entries are
 *   folded into the chapter that contains them;
 * - a parent entry whose first child starts at the same place is skipped (the child is the chapter);
 * - several spine files without a TOC entry are appended to the previous chapter;
 * - a fragment (`file.xhtml#id`) starts a new chapter only when that id exists in the document, otherwise the
 *   entry counts as the start of the file;
 * - no TOC at all: one chapter per spine file;
 * - text before the first TOC entry is kept as a front-matter chapter only when it has at least 20 words.
 */
import { countWords, firstHeading, htmlToMarkdown, splitAtMarkers } from "./markdown.ts";
import type { EpubStructure, TocEntry } from "./structure.ts";

export const MAX_TOC_DEPTH = 2;
export const FRONT_MATTER_MIN_WORDS = 20;
export const FRONT_MATTER_TITLE = "Materiale iniziale";

export interface Chapter {
  n: number;
  title: string;
  markdown: string;
  words: number;
}

interface Draft {
  title: string | undefined;
  parts: string[];
}

function selectEntries(toc: readonly TocEntry[], spinePaths: ReadonlySet<string>): TocEntry[] {
  const inSpine = toc.filter((e) => spinePaths.has(e.file));
  const shallow = inSpine.filter((e) => e.depth <= MAX_TOC_DEPTH);
  const result: TocEntry[] = [];
  shallow.forEach((entry, i) => {
    const next = shallow[i + 1];
    // Parent whose first child starts at the same place: the child is the real chapter.
    if (
      entry.hasChildren &&
      next &&
      next.depth > entry.depth &&
      next.file === entry.file &&
      (entry.fragment === undefined || entry.fragment === next.fragment)
    ) {
      return;
    }
    result.push(entry);
  });
  return result;
}

export function buildChapters(structure: EpubStructure): Chapter[] {
  const { spine } = structure;
  const spineIndex = new Map(spine.map((doc, i) => [doc.path, i]));
  let entries = selectEntries(structure.toc, new Set(spineIndex.keys()));

  // The TOC must follow the reading order; entries that jump back are dropped.
  let last = -1;
  entries = entries.filter((e) => {
    const idx = spineIndex.get(e.file)!;
    if (idx < last) return false;
    last = idx;
    return true;
  });

  const noToc = entries.length === 0;
  const drafts: Draft[] = [];
  let current: Draft | undefined;
  let front: Draft | undefined;
  const seenFileStart = new Set<string>();

  for (const doc of spine) {
    const docEntries = entries.filter((e) => e.file === doc.path);
    const anchors = docEntries.flatMap((e) => (e.fragment ? [e.fragment] : []));
    const uniqueAnchors = [...new Set(anchors)];
    const { markdown, found } = htmlToMarkdown(doc.html, uniqueAnchors);
    const { head, parts } = splitAtMarkers(markdown);

    // Entries that start this document (no fragment, or a fragment that does not exist in the file).
    const starts = docEntries.filter(
      (e) => !e.fragment || !found.has(uniqueAnchors.indexOf(e.fragment)),
    );
    const fileStart = starts[0];
    if (noToc) {
      current = { title: undefined, parts: [head] };
      drafts.push(current);
      continue;
    }
    if (fileStart && !seenFileStart.has(doc.path)) {
      seenFileStart.add(doc.path);
      current = { title: fileStart.title, parts: [head] };
      drafts.push(current);
    } else if (current) {
      current.parts.push(head);
    } else {
      front ??= { title: FRONT_MATTER_TITLE, parts: [] };
      front.parts.push(head);
    }

    const used = new Set<string>();
    for (const part of parts) {
      const fragment = uniqueAnchors[part.anchor]!;
      if (used.has(fragment)) continue;
      used.add(fragment);
      const entry = docEntries.find((e) => e.fragment === fragment)!;
      current = { title: entry.title, parts: [part.text] };
      drafts.push(current);
    }
  }

  if (front) {
    const text = front.parts.filter(Boolean).join("\n\n");
    if (countWords(text) >= FRONT_MATTER_MIN_WORDS) drafts.unshift(front);
  }

  const chapters: Chapter[] = [];
  for (const draft of drafts) {
    const body = draft.parts.filter(Boolean).join("\n\n").trim();
    if (!body) continue;
    const n = chapters.length + 1;
    const title = draft.title?.trim() || firstHeading(body) || `Capitolo ${n}`;
    const startsWithHeading = /^#{1,6}\s/.test(body);
    const markdown = startsWithHeading ? body : `# ${title}\n\n${body}`;
    chapters.push({ n, title, markdown: `${markdown}\n`, words: countWords(body) });
  }
  return chapters;
}
