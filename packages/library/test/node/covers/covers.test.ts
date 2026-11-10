import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  placeholderCover,
  placeholderSvg,
  saveCover,
  toCoverWebp,
} from "../../../src/node/covers/index.ts";
import { makeTrackedTempDir } from "../../helpers/index.ts";

async function png(width: number, height: number, extra?: ReturnType<typeof sharp>) {
  const base = extra ?? sharp({ create: { width, height, channels: 3, background: "#336699" } });
  return new Uint8Array(await base.png().toBuffer());
}

describe("toCoverWebp", () => {
  it("outputs WebP with width 600 for big images", async () => {
    const out = await toCoverWebp(await png(1800, 2700));
    const info = await sharp(out).metadata();
    expect(info.format).toBe("webp");
    expect(info.width).toBe(600);
    expect(info.height).toBe(900);
  });

  it("never upscales", async () => {
    const info = await sharp(await toCoverWebp(await png(200, 300))).metadata();
    expect(info.width).toBe(200);
  });

  it("applies EXIF rotation and strips metadata", async () => {
    const jpeg = new Uint8Array(
      await sharp({ create: { width: 400, height: 200, channels: 3, background: "#aa0000" } })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer(),
    );
    const info = await sharp(await toCoverWebp(jpeg)).metadata();
    expect(info.width).toBe(200);
    expect(info.height).toBe(400);
    expect(info.exif).toBeUndefined();
  });

  it("rejects garbage", async () => {
    await expect(toCoverWebp(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});

describe("placeholderCover", () => {
  it.each([
    ["Plain", "Someone"],
    ["Tom & Jerry <script>\"quote\" 'single'", "A & B <C>"],
    ["Città dell'anima: perché è così", "Niccolò È"],
    ["Parola ".repeat(60), "Un Autore Con Un Nome Molto Molto Molto Lungo Davvero"],
    ["Supercalifragilisticexpialidocious".repeat(4), undefined],
    ["", undefined],
  ])("renders %s", async (title, author) => {
    const out = await placeholderCover({ title, author });
    const info = await sharp(out).metadata();
    expect(info.format).toBe("webp");
    expect(info.width).toBe(600);
    expect(info.height).toBe(900);
  });

  it("escapes XML and is deterministic", () => {
    const svg = placeholderSvg({ title: "A & <b>", author: 'x"y' });
    expect(svg).not.toContain("<b>");
    expect(svg).toContain("A &amp; &lt;b&gt;");
    expect(placeholderSvg({ title: "Same" })).toBe(placeholderSvg({ title: "Same" }));
    expect(placeholderSvg({ title: "Same" })).not.toBe(placeholderSvg({ title: "Other" }));
  });
});

describe("saveCover", () => {
  it("writes cover.webp under the book dir", async () => {
    const dir = await makeTrackedTempDir("elib-cover-");
    const webp = await placeholderCover({ title: "T" });
    const file = await saveCover(dir, "abcd1234", webp);
    expect(file.endsWith(path.join("abcd1234", "cover.webp"))).toBe(true);
    await access(file);
    expect(new Uint8Array(await readFile(file))).toEqual(webp);
  });
});
