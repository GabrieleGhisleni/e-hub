import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KepubifyError, convertToKepub } from "../../../src/node/kepub/index.ts";
import { hasBinary } from "../../helpers/binaries.ts";
import { makeEpub } from "../../helpers/epub.ts";
import { type TempDir, makeTempDir } from "../../helpers/tmp.ts";

let tmp: TempDir;
beforeEach(async () => {
  tmp = await makeTempDir("elib-kepub-");
});
afterEach(async () => {
  await tmp.cleanup();
});

describe("convertToKepub argument checks", () => {
  it("requires a .kepub.epub output path", async () => {
    await expect(convertToKepub("/x/in.epub", path.join(tmp.dir, "out.epub"))).rejects.toThrow(
      /must end with \.kepub\.epub/,
    );
  });

  it("rejects a missing or empty input and input = output", async () => {
    await expect(
      convertToKepub(path.join(tmp.dir, "missing.epub"), path.join(tmp.dir, "o.kepub.epub")),
    ).rejects.toThrow(/cannot read input/);
    await writeFile(path.join(tmp.dir, "empty.epub"), "");
    await expect(
      convertToKepub(path.join(tmp.dir, "empty.epub"), path.join(tmp.dir, "o.kepub.epub")),
    ).rejects.toThrow(/not a non-empty file/);
    const same = path.join(tmp.dir, "same.kepub.epub");
    await expect(convertToKepub(same, same)).rejects.toThrow(/same file/);
  });

  it("reports a missing binary as a KepubifyError", async () => {
    const input = await makeEpub({ outPath: path.join(tmp.dir, "in.epub"), cover: false });
    const error = await convertToKepub(input, path.join(tmp.dir, "o.kepub.epub"), {
      binary: "/nonexistent/kepubify",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KepubifyError);
    expect((error as KepubifyError).exitCode).toBeNull();
    expect(await readdir(tmp.dir)).toEqual(["in.epub"]); // no temp file left
  });
});

describe.skipIf(!hasBinary("kepubify"))("convertToKepub with kepubify", () => {
  it("converts into place (koboSpan markup), creating the folder, leaving no temp file", async () => {
    const input = await makeEpub({ outPath: path.join(tmp.dir, "in.epub") });
    const output = path.join(tmp.dir, "cache", "books", "7k2m9q4t", "book.kepub.epub");
    expect(await convertToKepub(input, output)).toBe(output);
    const files = unzipSync(new Uint8Array(await readFile(output)));
    const xhtml = Object.entries(files).filter(([name]) => name.endsWith(".xhtml"));
    expect(xhtml.some(([, data]) => strFromU8(data).includes("koboSpan"))).toBe(true);
    expect(await readdir(path.dirname(output))).toEqual(["book.kepub.epub"]);

    // Overwrites an existing output.
    await writeFile(output, "stale");
    await convertToKepub(input, output);
    expect((await readFile(output)).length).toBeGreaterThan(5);
  });

  it("refuses an input that is already a KEPUB (kepubify would copy it unchanged)", async () => {
    const input = await makeEpub({ outPath: path.join(tmp.dir, "in.epub") });
    const kepub = await convertToKepub(input, path.join(tmp.dir, "first.kepub.epub"));
    const again = path.join(tmp.dir, "second.kepub.epub");
    await expect(convertToKepub(kepub, again)).rejects.toThrow(/unchanged/);
    expect((await readdir(tmp.dir)).sort()).toEqual(["first.kepub.epub", "in.epub"]);
  });

  it("fails on an invalid EPUB without leaving an output", async () => {
    const bad = path.join(tmp.dir, "bad.epub");
    await writeFile(bad, "not a zip");
    const error = await convertToKepub(bad, path.join(tmp.dir, "bad.kepub.epub")).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(KepubifyError);
    expect((error as KepubifyError).exitCode).toBe(1);
    expect(await readdir(tmp.dir)).toEqual(["bad.epub"]);
  });
});
