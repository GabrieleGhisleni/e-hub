import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src/core/errors";
import { recognizeUrl } from "../../src/core/ingest/recognize";
import {
  decodeEntities,
  episodeNumberFromTitle,
  guestsFromDescription,
  guestsFromTitle,
  isoDatePart,
  looksLikePersonName,
  normalizeTitle,
  rfc822ToIsoDate,
  splitSentences,
  titlesMatch,
} from "../../src/core/ingest/text";

describe("recognizeUrl", () => {
  it.each([
    ["https://lexfridman.com/andrew-scull/", "lex", "https://lexfridman.com/andrew-scull"],
    ["lexfridman.com/andrew-scull", "lex", "https://lexfridman.com/andrew-scull"],
    [
      "https://www.lexfridman.com/andrew-scull-transcript",
      "lex",
      "https://lexfridman.com/andrew-scull",
    ],
    ["https://lexfridman.com/dhh-2/?utm_source=rss#respond", "lex", "https://lexfridman.com/dhh-2"],
    [
      "https://www.hubermanlab.com/episode/some-episode-slug",
      "huberman",
      "https://www.hubermanlab.com/episode/some-episode-slug",
    ],
    [
      "hubermanlab.com/episode/some-episode-slug?ref=x",
      "huberman",
      "https://www.hubermanlab.com/episode/some-episode-slug",
    ],
    [
      "https://www.youtube.com/watch?v=s7d2d8FhevU&t=33s",
      "youtube",
      "https://www.youtube.com/watch?v=s7d2d8FhevU",
    ],
    [
      "https://youtu.be/s7d2d8FhevU?si=abc",
      "youtube",
      "https://www.youtube.com/watch?v=s7d2d8FhevU",
    ],
    [
      "https://m.youtube.com/watch?feature=share&v=s7d2d8FhevU",
      "youtube",
      "https://www.youtube.com/watch?v=s7d2d8FhevU",
    ],
    [
      "https://www.youtube.com/live/s7d2d8FhevU?feature=shared",
      "youtube",
      "https://www.youtube.com/watch?v=s7d2d8FhevU",
    ],
    [
      "https://youtube.com/shorts/s7d2d8FhevU",
      "youtube",
      "https://www.youtube.com/watch?v=s7d2d8FhevU",
    ],
  ])("%s → %s", (input, kind, url) => {
    expect(recognizeUrl(input)).toMatchObject({ kind, url });
  });

  it("extracts the episode slug and the YouTube id", () => {
    expect(recognizeUrl("https://lexfridman.com/jane-roe-transcript/")).toEqual({
      kind: "lex",
      slug: "jane-roe",
      url: "https://lexfridman.com/jane-roe",
    });
    expect(recognizeUrl("https://youtu.be/AbCdEfGhIj0")).toMatchObject({
      youtubeId: "AbCdEfGhIj0",
    });
  });

  it.each([
    "https://lexfridman.com/podcast/",
    "https://lexfridman.com/category/transcripts/",
    "https://lexfridman.com/",
    "https://www.hubermanlab.com/",
    "https://www.hubermanlab.com/newsletter/x",
    "https://www.youtube.com/@lexfridman",
    "https://www.youtube.com/watch?v=tooShort",
    "https://example.com/episode/1",
    "ftp://lexfridman.com/x",
    "not a url at all",
  ])("rejects %s", (input) => {
    expect(() => recognizeUrl(input)).toThrow(ValidationError);
  });
});

describe("text helpers", () => {
  it("decodes entities and normalises titles for matching", () => {
    expect(decodeEntities("Freud &#038; Jung &amp; co &#8211; x &#x2764; &bogus;")).toBe(
      "Freud & Jung & co – x ❤ &bogus;",
    );
    expect(normalizeTitle("Unlearn Negative Thoughts &amp; Behaviors | Dr. Alok Kanojia")).toBe(
      "unlearn negative thoughts and behaviors alok kanojia",
    );
    expect(normalizeTitle("Søberg’s Café")).toBe("sobergs cafe");
  });

  it("matches titles exactly or by a long enough prefix", () => {
    expect(
      titlesMatch(
        "Gizmo Science & Better Waffles | Dr. Pat Example",
        "Gizmo Science and Better Waffles - Pat Example",
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        "Unlearn Negative Thoughts & Behaviors Patterns | Dr. Alok Kanojia (Healthy Gamer)",
        "Unlearn Negative Thoughts & Behaviors Patterns | Dr. Alok Kanojia",
      ),
    ).toBe(true);
    expect(titlesMatch("Sleep", "Sleep Better Tonight")).toBe(false);
    expect(titlesMatch("How to Fold Paper Boats Quickly", "How to Fold Paper")).toBe(false);
  });

  it("finds episode numbers and dates", () => {
    expect(episodeNumberFromTitle("#502 – Psychiatry")).toBe(502);
    expect(episodeNumberFromTitle("Topic | Lex Fridman Podcast #26")).toBe(26);
    expect(episodeNumberFromTitle("Ep. 12: Something")).toBe(12);
    expect(episodeNumberFromTitle("Episode 7 - Something")).toBe(7);
    expect(episodeNumberFromTitle("Top 10 ideas of 2026")).toBeUndefined();
    expect(isoDatePart("2026-09-16T20:40:49-04:00")).toBe("2026-09-16");
    expect(isoDatePart("September 16")).toBeUndefined();
    expect(rfc822ToIsoDate("Thu, 17 Sep 2026 00:40:49 +0000")).toBe("2026-09-17");
    expect(rfc822ToIsoDate("garbage")).toBeUndefined();
  });

  it("recognises person names", () => {
    for (const name of [
      "Andrew Scull",
      "Jean-Baptiste Kempf",
      "Dr. Alok Kanojia",
      "Vincent van Gogh",
      "Betül Kaçar",
      "J. R. Tolkien",
    ])
      expect(looksLikePersonName(name), name).toBe(true);
    for (const text of [
      "Unlearn negative thoughts",
      "How Wars End",
      "State of AI in 2026",
      "Cursor Team",
      "Israel-Palestine Debate",
      "DHH",
      "Q&A Session",
    ])
      expect(looksLikePersonName(text), text).toBe(false);
    expect(looksLikePersonName("DHH", { allowSingleWord: true })).toBe(true);
  });

  it("splits sentences without breaking after abbreviations", () => {
    expect(splitSentences("Dr. Pat Example is a scientist. She works on gizmos.")).toEqual([
      "Dr. Pat Example is a scientist.",
      "She works on gizmos.",
    ]);
  });

  it("extracts guests from descriptions", () => {
    expect(guestsFromDescription("Andrew Scull is a historian of psychiatry.")).toEqual([
      "Andrew Scull",
    ]);
    expect(
      guestsFromDescription(
        "Ankur Moitra, Steven Brunton and Alex Kontorovich are three mathematicians. Ankur Moitra is at MIT.",
      ),
    ).toEqual(["Ankur Moitra", "Steven Brunton", "Alex Kontorovich"]);
    expect(guestsFromDescription("Jane Roe, John Doe, and Ada Example are researchers.")).toEqual([
      "Jane Roe",
      "John Doe",
      "Ada Example",
    ]);
    // Later sentences add full names only (not "Nathan is…").
    expect(
      guestsFromDescription(
        "Nathan Lambert and Sebastian Raschka are researchers. Nathan is the post-training lead. Amanda Askell is a researcher.",
      ),
    ).toEqual(["Nathan Lambert", "Sebastian Raschka", "Amanda Askell"]);
    expect(guestsFromDescription("David Heinemeier Hansson (aka DHH) is a programmer.")).toEqual([
      "David Heinemeier Hansson",
    ]);
    expect(guestsFromDescription("DHH is the creator of a web framework.")).toEqual(["DHH"]);
    expect(guestsFromDescription("On YouTube this episode is available in English.")).toEqual([]);
    expect(guestsFromDescription("Debate on war between Scott Horton and Mark Dubowitz.")).toEqual(
      [],
    );
  });

  it("extracts guests from titles by position", () => {
    expect(guestsFromTitle("#452 – Dario Amodei: Anthropic CEO on Claude")).toEqual([
      "Dario Amodei",
    ]);
    expect(
      guestsFromTitle("#497 – Biggest Mysteries in Physics: Antimatter & ToE – Don Lincoln"),
    ).toEqual(["Don Lincoln"]);
    expect(guestsFromTitle("#462 – Ezra Klein and Derek Thompson: Politics")).toEqual([
      "Ezra Klein",
      "Derek Thompson",
    ]);
    expect(
      guestsFromTitle("#502 – Psychiatry, Insane Asylums, Mental Illness, Freud & Jung"),
    ).toEqual([]);
    expect(
      guestsFromTitle(
        "Unlearn Negative Thoughts & Behaviors Patterns | Dr. Alok Kanojia (Healthy Gamer)",
      ),
    ).toEqual(["Alok Kanojia"]);
    expect(
      guestsFromTitle("Ada Example — Why wars are hard to end | Sam Host", {
        exclude: ["Sam Host"],
      }),
    ).toEqual(["Ada Example"]);
    expect(
      guestsFromTitle("Which AI is the best liar? | Sam Host", { exclude: ["Sam Host"] }),
    ).toEqual([]);
    expect(
      guestsFromTitle("Topic | Lex Fridman Podcast #26", { exclude: ["Lex Fridman"] }),
    ).toEqual([]);
    // Head is the (excluded) channel name and the tail is a title-cased topic:
    // both ends look like names, so neither is a guest.
    expect(
      guestsFromTitle("Sam Host - Never Gonna Stop Talking (Official Video)", {
        exclude: ["Sam Host"],
      }),
    ).toEqual([]);
    expect(
      guestsFromTitle("Ada Example — Why wars are hard to end", { exclude: ["Sam Host"] }),
    ).toEqual(["Ada Example"]);
  });
});
