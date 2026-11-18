import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MemoryBlobStore } from "@ehub/store";
import { afterEach, describe, expect, it } from "vitest";
import { cachedEpubPath, ensureDir } from "../../src/node/cache/index.ts";
import { blobEpubRemote, ensureCachedEpub, pushEpub, setEpubRemote } from "../../src/node/cache/remote.ts";
import { writeFile } from "node:fs/promises";

let dir: string | undefined;
afterEach(async () => {
  setEpubRemote(null);
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("EPUB remote (R2)", () => {
  it("does nothing without a remote", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "epub-remote-"));
    expect(await ensureCachedEpub(dir, "ab12cd34")).toBe(false);
  });

  it("pushes the cached EPUB and restores it into an empty cache", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "epub-remote-"));
    const blobs = new MemoryBlobStore();
    setEpubRemote(blobEpubRemote(blobs));
    const file = cachedEpubPath(dir, "ab12cd34");
    await ensureDir(path.dirname(file));
    await writeFile(file, "EPUB-BYTES");
    await pushEpub(dir, "ab12cd34");
    expect(blobs.objects.has("books/ab12cd34.epub")).toBe(true);

    await rm(file);
    expect(await ensureCachedEpub(dir, "ab12cd34")).toBe(true);
    expect(await readFile(file, "utf8")).toBe("EPUB-BYTES");
    expect(await ensureCachedEpub(dir, "zz99zz99")).toBe(false);
  });
});
