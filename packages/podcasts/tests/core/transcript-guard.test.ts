import { describe, expect, it } from "vitest";
import {
  TRANSCRIPT_EXCERPT_PLACEHOLDER,
  buildTranscriptIndex,
  findTranscriptExcerpts,
  redactTranscriptExcerpts,
  tokenize,
  utf8ByteLength,
} from "../../src/core/transcript-guard";
import { compactMarkdownExport, syntheticTranscript, toProse } from "../helpers";

const { transcript, words } = syntheticTranscript(3000);
const index = buildTranscriptIndex(transcript);

/** Words `from..from+count` of the transcript stream, re-punctuated and upper-cased differently. */
function quote(from: number, count: number): string {
  return toProse(words.slice(from, from + count), 99).toUpperCase();
}

describe("tokenize", () => {
  it("normalises case, punctuation, apostrophes and diacritics, keeping original offsets", () => {
    const text = "Héllo, WORLD! Don’t stop—now.";
    const tokens = tokenize(text);
    expect(tokens.map((token) => token.word)).toEqual(["hello", "world", "dont", "stop", "now"]);
    expect(text.slice(tokens[2]!.start, tokens[2]!.end)).toBe("Don’t");
  });

  it("treats timestamps, speaker labels, headings and line-number prefixes as transparent", () => {
    const text =
      "## Chapter one\n\n**Lex Fridman** [01:23:45] alpha beta\n\nGuest Name: [00:01] gamma (12:34) delta\n   12→epsilon";
    expect(tokenize(text).map((token) => token.word)).toEqual([
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
    ]);
  });
});

describe("findTranscriptExcerpts", () => {
  it("finds a 20-word run regardless of case and punctuation", () => {
    const text = `My own thought here. ${quote(500, 20)} And back to my own words.`;
    const spans = findTranscriptExcerpts(index, text);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.wordCount).toBe(20);
    expect(spans[0]!.preview.toLowerCase()).toContain(words[500]);
  });

  it("allows a 19-word quote", () => {
    const text = `My own thought here: "${quote(500, 19)}" and back to my own words.`;
    expect(findTranscriptExcerpts(index, text)).toEqual([]);
  });

  it("merges overlapping and adjacent windows into one maximal span", () => {
    const text = `Intro words. ${quote(100, 45)} outro words.`;
    const spans = findTranscriptExcerpts(index, text);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.wordCount).toBe(45);
  });

  it("reports separate runs separately", () => {
    const text = `First: ${quote(100, 25)} my comment in between. Second: ${quote(2000, 30)} end.`;
    expect(findTranscriptExcerpts(index, text).map((span) => span.wordCount)).toEqual([25, 30]);
  });

  it("returns nothing for a transcript shorter than 20 words", () => {
    const tiny = buildTranscriptIndex("one two three");
    expect(findTranscriptExcerpts(tiny, "one two three")).toEqual([]);
  });
});

describe("redactTranscriptExcerpts", () => {
  it("replaces each run with the placeholder and keeps the rest", () => {
    const text = `Before. ${quote(300, 30)} After the quote.`;
    const result = redactTranscriptExcerpts(index, text);
    expect(result.removed).toBe(1);
    expect(result.removedWords).toBe(30);
    expect(result.text).toBe(`Before. ${TRANSCRIPT_EXCERPT_PLACEHOLDER} After the quote.`);
  });

  it("collapses a pasted §4.4 markdown export into a single placeholder", () => {
    const exported = compactMarkdownExport(transcript);
    const conversation = `**User:** here is the transcript\n\n${exported}\n\n**Assistant:** Thanks, let's discuss it.`;
    const result = redactTranscriptExcerpts(index, conversation);
    expect(result.removed).toBe(1);
    expect(result.removedWords).toBe(words.length);
    expect(result.text).toContain("**User:** here is the transcript");
    expect(result.text).toContain("**Assistant:** Thanks, let's discuss it.");
    expect(result.text).toContain(TRANSCRIPT_EXCERPT_PLACEHOLDER);
    // Nothing of the transcript survives: no 2 consecutive transcript words left.
    const remaining = tokenize(result.text).map((token) => token.word);
    const vocab = new Set(words);
    expect(remaining.filter((word) => vocab.has(word))).toEqual([]);
  });

  it("is idempotent", () => {
    const once = redactTranscriptExcerpts(index, `x ${quote(10, 40)} y`).text;
    expect(redactTranscriptExcerpts(index, once)).toEqual({
      text: once,
      removed: 0,
      removedWords: 0,
    });
  });

  it("is fast on a 5-hour transcript (60k words) × a 200 KB conversation", () => {
    const big = syntheticTranscript(60_000, 11);
    const started = performance.now();
    const bigIndex = buildTranscriptIndex(big.transcript);
    let conversation = "";
    let n = 0;
    while (utf8ByteLength(conversation) < 200 * 1024) {
      conversation += `Question ${n} about the episode, my own words here.\n\n`;
      const from = (n * 397) % (big.words.length - 100);
      conversation += `${toProse(big.words.slice(from, from + 60), n)}\n\n`;
      n++;
    }
    const result = redactTranscriptExcerpts(bigIndex, conversation);
    const elapsed = performance.now() - started;
    expect(result.removed).toBe(n);
    expect(elapsed).toBeLessThan(3000);
  });
});
