import { describe, expect, it } from "vitest";
import { assessPrune } from "../../../src/node/kobo/index.ts";
import { type ReconcileAction, emptyReconcileReport } from "../../../src/shared/api.ts";

function reportWith(types: ReconcileAction["type"][]) {
  return {
    ...emptyReconcileReport(true),
    actions: types.map((type) => ({ type, status: "planned" as const })),
  };
}

const removes = (n: number) => Array.from({ length: n }, () => "remove" as const);

describe("assessPrune", () => {
  it("refuses when the data dir has no books", () => {
    const result = assessPrune(reportWith(removes(1)), 0, "/data");
    expect(result.refusal).toContain("no books");
  });

  it("refuses more than 10 removals", () => {
    expect(assessPrune(reportWith(removes(10)), 50, "/data").refusal).toBeNull();
    expect(assessPrune(reportWith(removes(11)), 50, "/data").refusal).toContain(
      "deleted from the Kobo (irreversible)",
    );
  });

  it("refuses more than 20% of the files, from 3 removals on", () => {
    // 3 removals of about 7 files (2 books): 43%
    expect(assessPrune(reportWith(removes(3)), 2, "/data").refusal).toContain("more than 20%");
    // 2 removals are always fine
    expect(assessPrune(reportWith(removes(2)), 1, "/data").refusal).toBeNull();
  });

  it("counts only removals, not uploads or renames", () => {
    const report = reportWith([
      ...Array.from({ length: 12 }, () => "upload" as const),
      "rename",
      "metadata",
    ]);
    const result = assessPrune(report, 1, "/data");
    expect(result.removals).toBe(0);
    expect(result.refusal).toBeNull();
  });
});
