import { afterEach, describe, expect, it } from "vitest";
import { HostedBackend, podcastsLayout } from "@ehub/store/hosted";
import { MemoryBlobStore, MemoryDocClient, mountBackend, unmountAll } from "@ehub/store";
import { DATA_DIR_ENV } from "../src/core/paths";
import { listEpisodes, listShows, readEpisode, writeEpisode, writeShow } from "../src/core/store";
import { SHOW, episodeFixture } from "./helpers";

afterEach(() => {
  unmountAll();
  delete process.env[DATA_DIR_ENV];
});

describe("podcast data on a hosted data dir", () => {
  it("stores shows and episodes as rows", async () => {
    const docs = new MemoryDocClient();
    process.env[DATA_DIR_ENV] = "/nonexistent/hosted-podcasts";
    mountBackend("/nonexistent/hosted-podcasts", new HostedBackend(docs, new MemoryBlobStore(), podcastsLayout));
    await writeShow(SHOW);
    await writeEpisode(episodeFixture());
    expect(await docs.get("shows", "demo-show")).not.toBeNull();
    expect((await readEpisode("demo-show-first-episode")).title).toBe("First episode");
    expect((await listShows()).map((s) => s.slug)).toEqual(["demo-show"]);
    expect((await listEpisodes()).map((e) => e.slug)).toEqual(["demo-show-first-episode"]);
  });
});
