import { describe, expect, it, vi } from "vitest";
import { apiPaths, BulkUpdateRequestSchema } from "@shared/api.ts";
import { adminApi } from "@library/admin/api.ts";
import { EMPTY_BULK, buildBulkPatch, describeBulkPatch } from "../../../src/web/admin/lib/bulk.ts";
import {
  addTags,
  collectTags,
  foldTag,
  normalizeTag,
  removeTag,
  suggestTags,
} from "../../../src/web/admin/lib/tags.ts";

describe("tags", () => {
  it("normalizes and folds", () => {
    expect(normalizeTag("  filosofia   antica ")).toBe("filosofia antica");
    expect(foldTag("Città")).toBe("citta");
  });
  it("adds several tags, skipping blanks and folded duplicates", () => {
    expect(addTags(["Città"], "citta, nuovo;  ; Nuovo\naltro")).toEqual([
      "Città",
      "nuovo",
      "altro",
    ]);
  });
  it("removes case/accent-insensitively", () => {
    expect(removeTag(["Città", "x"], "CITTA")).toEqual(["x"]);
  });
  it("collects usage with the most frequent spelling", () => {
    const usage = collectTags([
      { tags: ["Etica", "mente"] },
      { tags: ["etica"] },
      { tags: ["Etica"] },
      { tags: [] },
    ]);
    expect(usage).toEqual([
      { tag: "Etica", count: 3 },
      { tag: "mente", count: 1 },
    ]);
  });
  it("suggests prefix matches first and hides chosen tags", () => {
    const all = [
      { tag: "storia antica", count: 3 },
      { tag: "antico egitto", count: 2 },
      { tag: "mente", count: 1 },
    ];
    expect(suggestTags(all, "ant", []).map((u) => u.tag)).toEqual([
      "antico egitto",
      "storia antica",
    ]);
    expect(suggestTags(all, "", ["Mente"]).map((u) => u.tag)).toEqual([
      "storia antica",
      "antico egitto",
    ]);
    expect(suggestTags(all, "zzz", [])).toEqual([]);
  });
});

describe("bulk", () => {
  it("is null when nothing is set", () => expect(buildBulkPatch(EMPTY_BULK)).toBeNull());
  it("builds a valid patch; add wins over remove", () => {
    const patch = buildBulkPatch({
      topic: "storia",
      status: "read",
      addTags: ["Nuovo", "nuovo", "x"],
      removeTags: ["X", "vecchio"],
    });
    expect(patch).toEqual({
      topic: "storia",
      status: "read",
      addTags: ["Nuovo", "x"],
      removeTags: ["vecchio"],
    });
    expect(BulkUpdateRequestSchema.safeParse({ ids: ["abcdefgh"], patch }).success).toBe(true);
  });
  it("describes the patch", () => {
    const lines = describeBulkPatch(
      { topic: "t", status: "read", addTags: ["a"], removeTags: ["b"] },
      { topic: (id) => `T(${id})`, status: () => "Letto" },
    );
    expect(lines).toEqual(["argomento: T(t)", "stato: Letto", "aggiungi tag: a", "rimuovi tag: b"]);
  });
});

describe("bulk deletion (admin API client)", () => {
  it("uses the existing per-book endpoint and keeps partial failures", async () => {
    const first = "aaaaaaaa";
    const second = "bbbbbbbb";
    const third = "cccccccc";
    const fetchMock = vi.fn(async (url: string) => {
      if (url === apiPaths.book(second)) {
        return Response.json(
          { error: { code: "kobo-failed", message: "Kobo non raggiungibile." } },
          { status: 502 },
        );
      }
      const id = url === apiPaths.book(first) ? first : third;
      return Response.json({
        id,
        report: { dryRun: false, actions: [], warnings: [], errors: [] },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await adminApi.bulkDelete([first, second, third]);
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        apiPaths.book(first),
        apiPaths.book(second),
        apiPaths.book(third),
      ]);
      expect(result.deletedIds).toEqual([first, third]);
      expect(result.failures.get(second)).toMatchObject({ code: "kobo-failed" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
