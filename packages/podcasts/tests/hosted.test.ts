import { afterEach, describe, expect, it } from "vitest";
import { HostedBackend, podcastsLayout } from "@ehub/store/hosted";
import { MemoryBlobStore, MemoryDocClient, mountBackend, runAsUser, unmountAll } from "@ehub/store";
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
