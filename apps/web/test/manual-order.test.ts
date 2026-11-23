import { describe, expect, it } from "vitest";
import { moveInOrder } from "@ehub/ui";

describe("moveInOrder", () => {
  it("moves an item to the place of the target and keeps hidden items after", () => {
    expect(moveInOrder(["a", "b", "c"], ["a", "b", "c", "x"], "c", "a")).toEqual(["c", "a", "b", "x"]);
    expect(moveInOrder(["a", "b", "c"], [], "a", "c")).toEqual(["b", "c", "a"]);
    expect(moveInOrder(["a", "b"], ["b", "a"], "a", "a")).toEqual(["b", "a"]);
  });
});
