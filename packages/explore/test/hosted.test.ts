import { afterEach, describe, expect, it } from "vitest";
import { HostedBackend, exploreLayout } from "@ehub/store/hosted";
import { MemoryBlobStore, MemoryDocClient, mountBackend, runAsUser, unmountAll } from "@ehub/store";
import { DATA_DIR_ENV, createExploration, listExplorations, readExploration } from "../src/node/index.ts";
import { fakeLibrary } from "./fakes.ts";

afterEach(() => {
  unmountAll();
  delete process.env[DATA_DIR_ENV];
});

describe("explorations on a hosted data dir", () => {
  it("are rows of the `explorations` table", () => runAsUser("u1", async () => {
    const docs = new MemoryDocClient();
    process.env[DATA_DIR_ENV] = "/nonexistent/hosted-explore";
    mountBackend("/nonexistent/hosted-explore", new HostedBackend(docs, new MemoryBlobStore(), exploreLayout));
    const created = await createExploration(
      { title: "Sul tempo", question: "Cos'è?" },
      new Date(2026, 10, 12, 10),
      fakeLibrary(),
    );
    expect((await docs.forUser("u1").get("explorations", created.id))?.data).toMatchObject({ title: "Sul tempo" });
    expect((await readExploration(created.id)).question).toBe("Cos'è?");
    expect((await listExplorations()).map((e) => e.id)).toEqual([created.id]);
  }));
});
