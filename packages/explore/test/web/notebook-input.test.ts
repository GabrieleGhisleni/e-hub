import { describe, expect, it } from "vitest";
import { notebookChunk } from "../../src/web/notebook-input.ts";

describe("notebookChunk", () => {
  it("puts the question in bold, a blank line, then the answer", () => {
    expect(notebookChunk({ question: "Qual è la tesi?", answer: "Il ressentimento." })).toBe(
      "**Qual è la tesi?**\n\nIl ressentimento.",
    );
  });

  it("collapses the whitespace of the question and trims the answer", () => {
    expect(notebookChunk({ question: "  Qual è\n\n  la   tesi?  ", answer: "\n- punto uno\n- punto due\n" })).toBe(
      "**Qual è la tesi?**\n\n- punto uno\n- punto due",
    );
  });

  it("has no question line when the note comes without one, and no origin line", () => {
    const chunk = notebookChunk({ answer: "  Solo la risposta.  " });
    expect(chunk).toBe("Solo la risposta.");
    expect(chunk).not.toMatch(/Dalla chat/);
  });

  it("does not keep a question that is only spaces", () => {
    expect(notebookChunk({ question: "   ", answer: "Risposta." })).toBe("Risposta.");
  });
});
