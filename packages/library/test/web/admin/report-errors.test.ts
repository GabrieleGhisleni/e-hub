import { describe, expect, it } from "vitest";
import type { ReconcileReport } from "../../../src/shared/api.ts";
import {
  ApiRequestError,
  friendlyMessage,
  isRetryable,
} from "../../../src/web/admin/lib/errors.ts";
import { baseName, summarizeReport } from "../../../src/web/admin/lib/report.ts";

const empty: ReconcileReport = { dryRun: false, actions: [], warnings: [], errors: [] };

describe("summarizeReport", () => {
  it("is calm for an empty report", () => {
    const s = summarizeReport(empty);
    expect(s.needsAttention).toBe(false);
    expect(s.text).toBe("Nessuna operazione sul Kobo");
  });
  it("counts done actions with plural forms and flags problems", () => {
    const s = summarizeReport({
      ...empty,
      actions: [
        { type: "upload", status: "done" },
        { type: "upload", status: "done" },
        { type: "rename", status: "done" },
        { type: "rename", status: "failed" },
      ],
      warnings: [{ code: "orphan-file", message: "x" }],
      errors: [{ code: "ssh-failed", message: "y" }],
    });
    expect(s).toMatchObject({ done: 3, failed: 1, warnings: 1, errors: 1, needsAttention: true });
    expect(s.text).toBe("2 file inviati al Kobo, 1 file rinominato sul Kobo · 1 errore, 1 avviso");
  });
  it("flags a failed action even without messages", () => {
    expect(
      summarizeReport({ ...empty, actions: [{ type: "remove", status: "failed" }] }).needsAttention,
    ).toBe(true);
  });
  it("baseName", () => {
    expect(baseName("Kobo/Storia/x.kepub.epub")).toBe("x.kepub.epub");
    expect(baseName(undefined)).toBe("");
  });
});

describe("errors", () => {
  it("maps transport errors to a friendly message and keeps API messages", () => {
    expect(
      friendlyMessage(
        new ApiRequestError({ status: 0, code: "network", message: "Failed to fetch" }),
      ),
    ).toMatch(/server locale/);
    expect(
      friendlyMessage(
        new ApiRequestError({ status: 400, code: "not-an-epub", message: "Non è un EPUB." }),
      ),
    ).toBe("Non è un EPUB.");
    expect(friendlyMessage(new Error("boom"))).toContain("boom");
  });
  it("extracts the report of a kobo-failed error", () => {
    const e = new ApiRequestError({
      status: 502,
      code: "kobo-failed",
      message: "Kobo",
      details: { report: empty },
    });
    expect(e.report).toEqual(empty);
    expect(
      new ApiRequestError({ status: 400, code: "x", message: "m", details: { report: 1 } }).report,
    ).toBeNull();
    expect(isRetryable(e)).toBe(true);
    expect(isRetryable(new ApiRequestError({ status: 400, code: "x", message: "m" }))).toBe(false);
  });
});

describe("isServerDownStatus", () => {
  it("treats the dev proxy's 500/502/503/504 as 'server not running'", async () => {
    const { isServerDownStatus } = await import("../../../src/web/admin/lib/errors.ts");
    for (const s of [500, 502, 503, 504]) expect(isServerDownStatus(s)).toBe(true);
    for (const s of [400, 404, 409, 501]) expect(isServerDownStatus(s)).toBe(false);
  });
});
