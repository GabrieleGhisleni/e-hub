import { afterEach, describe, expect, it } from "vitest";
import { HostedBackend, podcastsLayout } from "@ehub/store/hosted";
import { MemoryBlobStore, MemoryDocClient, mountBackend, runAsUser, unmountAll } from "@ehub/store";
import type { Transcript } from "../src/core/schema";
import { DATA_DIR_ENV } from "../src/core/paths";
import { listEpisodes, listShows, readEpisode, writeEpisode, writeShow } from "../src/core/store";
import { SHOW, episodeFixture } from "./helpers";

afterEach(() => {
  unmountAll();
  delete process.env[DATA_DIR_ENV];
});

describe("podcast data on a hosted data dir", () => {
  it("stores shows and episodes as rows", () => runAsUser("u1", async () => {
    const docs = new MemoryDocClient();
    process.env[DATA_DIR_ENV] = "/nonexistent/hosted-podcasts";
    mountBackend("/nonexistent/hosted-podcasts", new HostedBackend(docs, new MemoryBlobStore(), podcastsLayout));
    await writeShow(SHOW);
    await writeEpisode(episodeFixture());
    expect(await docs.forUser("u1").get("shows", "demo-show")).not.toBeNull();
    expect((await readEpisode("demo-show-first-episode")).title).toBe("First episode");
    expect((await listShows()).map((s) => s.slug)).toEqual(["demo-show"]);
    expect((await listEpisodes()).map((e) => e.slug)).toEqual(["demo-show-first-episode"]);
  }));
});

describe("read endpoints for the hosted site", () => {
  it("serve the catalog and the conversations", () => runAsUser("u1", async () => {
    const { createApp } = await import("../src/server/app");
    const docs = new MemoryDocClient();
    process.env[DATA_DIR_ENV] = "/nonexistent/hosted-podcasts-api";
    mountBackend("/nonexistent/hosted-podcasts-api", new HostedBackend(docs, new MemoryBlobStore(), podcastsLayout));
    await writeShow(SHOW);
    await writeEpisode(episodeFixture());
    const app = createApp({ access: async (_c, next) => next() });
    const catalog = (await (await app.request("/api/podcasts/catalog")).json()) as { shows: unknown[]; episodes: { slug: string }[] };
    expect(catalog.shows).toHaveLength(1);
    expect(catalog.episodes.map((e) => e.slug)).toEqual(["demo-show-first-episode"]);
    const res = await app.request("/api/podcasts/episodes/demo-show-first-episode/conversations");
    expect(await res.json()).toEqual({ conversations: [] });
    expect((await app.request("/api/podcasts/episodes/missing-one/conversations")).status).toBe(404);
  }));
});

it("atomically stores a local upload for its owner and rejects a stale update", async () => {
  const { createApp } = await import("../src/server/app");
  const docs = new MemoryDocClient();
  process.env[DATA_DIR_ENV] = "/nonexistent/hosted-transcripts";
  mountBackend(process.env[DATA_DIR_ENV], new HostedBackend(docs, new MemoryBlobStore(), podcastsLayout));
  const episode = episodeFixture({ youtubeId: "RA7tLTZltKI" });
  const saved = await runAsUser("u1", () => writeEpisode(episode));
  const app = createApp({ access: async (_c, next) => next() });
  const route = `/api/podcasts/episodes/${episode.slug}/transcript`;
  const body = {
    expectedUpdatedAt: saved.updatedAt,
    transcript: { mode: "local", data: {
      videoId: episode.youtubeId, model: "base",
      result: { segments: [{ start: 1, end: 2, text: "Private transcript." }] },
    } },
  };
  const put = (user: string, value: unknown) => runAsUser(user, () => app.request(route, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
  }));
  expect((await put("u2", body)).status).toBe(404);
  expect((await put("u1", body)).status).toBe(200);
  expect((await put("u1", body)).status).toBe(409);
  expect((await runAsUser("u2", () => app.request(route))).status).toBe(404);
  const get = () => runAsUser("u1", () => app.request(route));
  const response = await get();
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const stored = await response.json() as { transcript: Transcript; updatedAt: string };
  expect(stored.transcript.segments[0]?.text).toBe("Private transcript.");
  expect((await put("u2", { expectedUpdatedAt: stored.updatedAt, transcript: { mode: "none" } })).status).toBe(404);
  expect((await put("u1", { expectedUpdatedAt: stored.updatedAt, transcript: { mode: "none" } })).status).toBe(200);
  expect(await docs.forUser("u1").get("podcast_transcripts", episode.slug)).toBeNull();
});

it("reuses running transcription jobs and keeps job status scoped to the owner", async () => {
  const { createTranscriptionJobs } = await import("../src/server/transcription-jobs");
  const jobs = createTranscriptionJobs();
  let finish!: (value: string) => void;
  const task = new Promise<string>((resolve) => { finish = resolve; });
  const first = runAsUser("u1", () => jobs.start("episode", (progress) => {
    progress("Parte 1 di 2");
    return task;
  }));
  expect(runAsUser("u1", () => jobs.start("episode", async () => "duplicate"))).toBe(first);
  expect(runAsUser("u2", () => jobs.get(first))).toBeUndefined();
  expect(runAsUser("u1", () => jobs.get(first))).toEqual({ state: "running", progress: "Parte 1 di 2" });
  finish("saved");
  await task;
  expect(runAsUser("u1", () => jobs.get(first))).toEqual({ state: "done", result: "saved" });
});
