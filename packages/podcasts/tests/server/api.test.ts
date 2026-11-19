/** Endpoint behaviour and error mapping, against temp data dirs and a fake network. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app";
import { toErrorResponse } from "../../src/server/errors";
import { writeTranscript } from "../../src/core/transcripts";
import { HttpError } from "../../src/core/ingest/http";
import { readEpisode, readTranscript } from "../../src/core/store";
import { listFilesRecursive, seedEpisode, syntheticTranscript, useTempDirs } from "../helpers";
import {
  fakeFetch,
  fakeGit,
  fixture,
  itunesSearchUrl,
  oembed,
  oembedUrl,
  pngBytes,
  watchPage,
  type FakeFetch,
} from "../ingest/fakes";

const dirs = useTempDirs();
const SLUG = "demo-show-first-episode";
const GENERIC_ID = "GnGnGnGnGn1";
const NOW = new Date("2026-11-10T08:00:00.000Z");

let net: FakeFetch;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  const png = await pngBytes();
  net = fakeFetch({
    [oembedUrl(GENERIC_ID)]: oembed(
      "Ada Example — Thinking about thinking | Sam Host",
      "Sam Host",
      "https://www.youtube.com/@samhost",
    ),
    [`https://www.youtube.com/watch?v=${GENERIC_ID}`]: watchPage({
      date: "2026-09-25T10:00:00-07:00",
    }),
    "https://www.youtube.com/@samhost": `<meta property="og:image" content="https://yt3.example.com/avatar=s900">`,
    "https://yt3.example.com/avatar=s900": png,
    [itunesSearchUrl("Sam Host")]: await fixture("itunes-search.json"),
    "https://feeds.example.com/example-talks.rss": await fixture("generic-feed.xml"),
    "https://img.example.com/example-talks.jpg": png,
  });
  app = createApp({ ingest: { fetch: net.fetch, git: fakeGit().git, now: () => NOW } });
});

function request(method: string, route: string, body?: unknown) {
  return app.request(`http://localhost:5173${route}`, {
    method,
    headers: {
      host: "localhost:5173",
      origin: "http://localhost:5173",
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
// eslint-disable-next-line typescript/no-explicit-any
const readJson = async (res: Response): Promise<any> => res.json();
const get = (route: string) =>
  app.request(`http://localhost:5173${route}`, { headers: { host: "localhost:5173" } });

describe("error mapping", () => {
  it("never leaks stack traces for unexpected errors", () => {
    const { status, body } = toErrorResponse(new Error("secret path /home/x"));
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(body.code).toBe("internal");
  });

  it("maps network failures to 502", () => {
    const { status, body } = toErrorResponse(new HttpError("https://example.com/x", 500));
    expect(status).toBe(502);
    expect(body.code).toBe("network");
  });
});

describe("GET /api/podcasts/tags", () => {
  it("lists existing tags with counts", async () => {
    await seedEpisode({ tags: ["sleep", "ai"] });
    const res = await get("/api/podcasts/tags");
    expect(await readJson(res)).toEqual([
      { tag: "ai", count: 1 },
      { tag: "sleep", count: 1 },
    ]);
  });
});

describe("slugs", () => {
  it("rejects invalid slugs before touching the filesystem", async () => {
    for (const slug of ["Bad_Slug", "a%2F..%2Fb", "UPPER"]) {
      const res = await request("PUT", `/api/podcasts/episodes/${slug}`, {
        expectedUpdatedAt: "x",
      });
      expect(res.status, slug).toBe(400);
      expect(await readJson(res)).toMatchObject({ code: "bad-request" });
    }
    const res = await get("/api/podcasts/episodes/..%2f..%2fetc/transcript.md");
    expect([400, 404]).toContain(res.status);
    expect(await listFilesRecursive(dirs.root)).toEqual([]);
  });

  it("404s for an unknown episode", async () => {
    const res = await request("PUT", "/api/podcasts/episodes/missing-episode", {
      expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      notes: "x",
    });
    expect(res.status).toBe(404);
    expect(await readJson(res)).toMatchObject({ code: "not-found" });
  });
});

describe("PUT /api/podcasts/episodes/:slug", () => {
  it("saves fields and returns the new updatedAt", async () => {
    const episode = await seedEpisode();
    const res = await request("PUT", `/api/podcasts/episodes/${SLUG}`, {
      expectedUpdatedAt: episode.updatedAt,
      notes: "New notes",
      tags: ["Sleep", "New Tag"],
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.changedFields).toEqual(["notes", "tags"]);
    const stored = await readEpisode(SLUG);
    expect(stored.notes).toBe("New notes");
    expect(stored.tags).toEqual(["sleep", "new-tag"]);
    expect(body.updatedAt).toBe(stored.updatedAt);
    expect(stored.summary).toEqual(["A first point."]); // absent = unchanged
  });

  it("saves and clears guest descriptions", async () => {
    const episode = await seedEpisode();
    const description = "Guest Person studies sleep.";
    const res = await request("PUT", `/api/podcasts/episodes/${SLUG}`, {
      expectedUpdatedAt: episode.updatedAt,
      guestDescriptions: { "Guest Person": description },
    });
    expect(res.status).toBe(200);
    const stored = await readEpisode(SLUG);
    expect(stored.guestDescriptions).toEqual({ "Guest Person": description });

    const cleared = await request("PUT", `/api/podcasts/episodes/${SLUG}`, {
      expectedUpdatedAt: stored.updatedAt,
      guestDescriptions: {},
    });
    expect(cleared.status).toBe(200);
    expect((await readEpisode(SLUG)).guestDescriptions).toEqual({});
  });

  it("409 on a stale expectedUpdatedAt, nothing written", async () => {
    await seedEpisode();
    const res = await request("PUT", `/api/podcasts/episodes/${SLUG}`, {
      expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
      notes: "Lost",
    });
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body).toMatchObject({ code: "conflict", expectedUpdatedAt: "2020-01-01T00:00:00.000Z" });
    expect(body.actualUpdatedAt).toBeTruthy();
    expect((await readEpisode(SLUG)).notes).toBe("Original notes.");
  });

  it("422 with the message on validation errors", async () => {
    const episode = await seedEpisode();
    const res = await request("PUT", `/api/podcasts/episodes/${SLUG}`, {
      expectedUpdatedAt: episode.updatedAt,
      tags: ["not valid!"],
    });
    expect(res.status).toBe(422);
    const body = await readJson(res);
    expect(body.code).toBe("validation");
    expect(body.details.join(" ")).toMatch(/tags\[0\]/);
  });

  it("422 when the transcript guard rejects notes", async () => {
    const episode = await seedEpisode();
    const { transcript } = syntheticTranscript(500);
    await writeTranscript(SLUG, transcript);
    const quote = transcript.segments
      .slice(0, 4)
      .map((s) => s.text)
      .join(" ");
    const res = await request("PUT", `/api/podcasts/episodes/${SLUG}`, {
      expectedUpdatedAt: (await readEpisode(SLUG)).updatedAt,
      notes: quote,
    });
    expect(episode.slug).toBe(SLUG);
    expect(res.status).toBe(422);
    expect(await readJson(res)).toMatchObject({ code: "transcript-guard" });
  });

  it("400 for malformed JSON and unknown fields", async () => {
    const episode = await seedEpisode();
    const bad = await app.request(`http://localhost:5173/api/podcasts/episodes/${SLUG}`, {
      method: "PUT",
      headers: {
        host: "localhost:5173",
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: "{nope",
    });
    expect(bad.status).toBe(400);
    const extra = await request("PUT", `/api/podcasts/episodes/${SLUG}`, {
      expectedUpdatedAt: episode.updatedAt,
      slug: "other",
    });
    expect(extra.status).toBe(400);
  });
});

describe("DELETE /api/podcasts/episodes/:slug", () => {
  it("removes the episode with its conversations and transcript", async () => {
    await seedEpisode();
    await writeTranscript(SLUG, syntheticTranscript(50).transcript);
    await request("POST", `/api/podcasts/episodes/${SLUG}/conversations`, {
      agent: "Claude",
      markdown: "A short chat.",
    });
    const res = await request("DELETE", `/api/podcasts/episodes/${SLUG}`);
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({ slug: SLUG });
    const left = (await listFilesRecursive(dirs.data)).filter((file) => file.includes(SLUG));
    expect(left).toEqual([]);
  });

  it("404s for an unknown episode and 400s for a bad slug", async () => {
    expect((await request("DELETE", "/api/podcasts/episodes/missing-episode")).status).toBe(404);
    expect((await request("DELETE", "/api/podcasts/episodes/Bad_Slug")).status).toBe(400);
  });
});

describe("POST /api/podcasts/episodes/:slug/conversations", () => {
  it("adds a conversation and reports removed excerpts", async () => {
    await seedEpisode();
    const { transcript } = syntheticTranscript(800);
    await writeTranscript(SLUG, transcript);
    const excerpt = transcript.segments
      .slice(0, 5)
      .map((s) => s.text)
      .join(" ");
    const res = await request("POST", `/api/podcasts/episodes/${SLUG}/conversations`, {
      agent: "Claude",
      markdown: `Question about it.\n\n${excerpt}\n\nAnd my thoughts.`,
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.conversations).toMatchObject({ added: 1, skipped: 0 });
    expect(body.conversations.excerptsRemoved).toBeGreaterThanOrEqual(1);
    const stored = JSON.parse(
      await readFile(path.join(dirs.data, "conversations", `${SLUG}.json`), "utf8"),
    );
    expect(stored[0].markdown).toContain("[estratto della trascrizione rimosso]");

    // Same text again: skipped.
    const again = await request("POST", `/api/podcasts/episodes/${SLUG}/conversations`, {
      agent: "Claude",
      markdown: `Question about it.\n\n${excerpt}\n\nAnd my thoughts.`,
    });
    expect((await readJson(again)).conversations).toMatchObject({ added: 0, skipped: 1 });
  });

  it("422 for an empty conversation and 409 for a stale expectedUpdatedAt", async () => {
    await seedEpisode();
    const empty = await request("POST", `/api/podcasts/episodes/${SLUG}/conversations`, {
      agent: "Claude",
      markdown: "  ",
    });
    expect(empty.status).toBe(422);
    const stale = await request("POST", `/api/podcasts/episodes/${SLUG}/conversations`, {
      agent: "Claude",
      markdown: "Hi",
      expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(stale.status).toBe(409);
  });
});

describe("speakers and export", () => {
  it("lists, swaps and exports", async () => {
    await seedEpisode();
    const none = await get(`/api/podcasts/episodes/${SLUG}/transcript/speakers`);
    expect(await none.json()).toEqual({ available: false, speakers: [] });
    expect((await get(`/api/podcasts/episodes/${SLUG}/transcript.md`)).status).toBe(404);

    const { transcript } = syntheticTranscript(300);
    await writeTranscript(SLUG, transcript);
    const listed = await readJson(await get(`/api/podcasts/episodes/${SLUG}/transcript/speakers`));
    expect(listed.available).toBe(true);
    expect(listed.speakers.map((s: { speaker: string }) => s.speaker)).toEqual([
      "Host Person",
      "Guest Person",
    ]);

    const swapped = await request("POST", `/api/podcasts/episodes/${SLUG}/transcript/speakers`, {
      mapping: { "Host Person": "Guest Person", "Guest Person": "Host Person" },
    });
    expect(swapped.status).toBe(200);
    expect((await readTranscript(SLUG)).segments[0]!.speaker).toBe("Guest Person");

    const bad = await request("POST", `/api/podcasts/episodes/${SLUG}/transcript/speakers`, {
      mapping: { Nobody: "X" },
    });
    expect(bad.status).toBe(422);

    const md = await get(`/api/podcasts/episodes/${SLUG}/transcript.md`);
    expect(md.status).toBe(200);
    expect(md.headers.get("content-type")).toMatch(/^text\/markdown/);
    expect(await md.text()).toContain("# First episode");
  });
});

describe("add episode", () => {
  const url = `https://www.youtube.com/watch?v=${GENERIC_ID}`;

  it("previews, asks for the feed decision, then adds", async () => {
    const preview = await readJson(
      await request("POST", "/api/podcasts/episodes/preview", { url }),
    );
    expect(preview).toMatchObject({
      status: "ready",
      show: { status: "new", needsFeedDecision: true },
    });
    expect(await listFilesRecursive(dirs.root)).toEqual([]);

    const undecided = await request("POST", "/api/podcasts/episodes", { url });
    expect(undecided.status).toBe(422);
    const undecidedBody = await readJson(undecided);
    expect(undecidedBody.code).toBe("feed-decision-required");
    expect(undecidedBody.candidates.length).toBeGreaterThan(0);

    const added = await request("POST", "/api/podcasts/episodes", { url, feed: null });
    expect(added.status).toBe(201);
    const body = await readJson(added);
    expect(body.status).toBe("created");
    expect((await readEpisode(body.episode.slug)).title).toContain("Thinking about thinking");

    const duplicate = await request("POST", "/api/podcasts/episodes", { url, feed: null });
    expect((await readJson(duplicate)).status).toBe("duplicate");
  });

  it("rejects addedAt (CLI-only) and bad URLs", async () => {
    const withDate = await request("POST", "/api/podcasts/episodes", {
      url,
      feed: null,
      addedAt: "2020-01-01",
    });
    expect(withDate.status).toBe(400);
    const bad = await request("POST", "/api/podcasts/episodes/preview", { url: "ftp://nope" });
    expect(bad.status).toBe(422);
  });

  it("maps network failures to 502", async () => {
    net.routes.set(oembedUrl(GENERIC_ID), { error: "boom" });
    const res = await request("POST", "/api/podcasts/episodes/preview", { url });
    expect(res.status).toBe(502);
    const body = await readJson(res);
    expect(body.error).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/\bat \w+.*\.ts/);
  });
});
