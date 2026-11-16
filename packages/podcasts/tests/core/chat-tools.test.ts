// `propose_episode_edit`: validates the proposal, answers without claiming anything was saved, never writes.

import { describe, expect, it } from "vitest";
import { EPISODE_EDIT_PROPOSAL_MESSAGE, ProposeEpisodeEditInput } from "../../src/core/chat-edit";
import { episodeChatTools } from "../../src/core/chat-tools";

describe("ProposeEpisodeEditInput", () => {
  it("accepts any subset of fields and rejects an empty proposal", () => {
    expect(ProposeEpisodeEditInput.safeParse({ summary: ["Un punto"] }).success).toBe(true);
    expect(ProposeEpisodeEditInput.safeParse({ notes: "x", tags: ["sleep"], guests: ["Ada"] }).success).toBe(true);
    expect(ProposeEpisodeEditInput.safeParse({}).success).toBe(false);
  });

  it("applies the schema limits and refuses unknown fields", () => {
    expect(ProposeEpisodeEditInput.safeParse({ summary: Array(11).fill("a") }).success).toBe(false);
    expect(ProposeEpisodeEditInput.safeParse({ tags: ["Not Kebab"] }).success).toBe(false);
    expect(ProposeEpisodeEditInput.safeParse({ title: "x" }).success).toBe(false);
  });
});

describe("propose_episode_edit tool", () => {
  const run = (input: unknown) => {
    const tool = episodeChatTools().propose_episode_edit as unknown as {
      execute: (input: unknown) => unknown;
    };
    return tool.execute(input);
  };

  it("answers that the proposal is shown, not saved", () => {
    expect(run({ summary: ["Un punto"] })).toBe(EPISODE_EDIT_PROPOSAL_MESSAGE);
  });

  it("asks the model to fix an invalid proposal", () => {
    expect(String(run({ summary: Array(11).fill("a") }))).toContain("propose_episode_edit");
  });
});
