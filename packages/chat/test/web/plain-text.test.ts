import { describe, expect, it } from "vitest";
import { markdownToPlainText } from "../../src/web/plain-text.ts";

describe("markdownToPlainText", () => {
  it("removes emphasis, strikethrough and inline code markers", () => {
    expect(markdownToPlainText("Una **tesi** forte, *quasi* _sicura_ e ~~debole~~ con `codice`.")).toBe(
      "Una tesi forte, quasi sicura e debole con codice.",
    );
  });

  it("leaves underscores inside words alone", () => {
    expect(markdownToPlainText("Il campo data_frame_name resta uguale.")).toBe(
      "Il campo data_frame_name resta uguale.",
    );
  });

  it("removes heading markers and blockquote markers", () => {
    expect(markdownToPlainText("## Titolo\n\n> citazione parafrasata")).toBe("Titolo\n\ncitazione parafrasata");
  });

  it("keeps the code of a fenced block and drops the fence lines", () => {
    expect(markdownToPlainText("Ecco:\n```ts\nconst x = 1;\n```\nFine.")).toBe("Ecco:\nconst x = 1;\nFine.");
  });

  it("keeps list bullets (normalised to dashes) and line breaks", () => {
    expect(markdownToPlainText("* primo\n* **secondo**\n\n1. terzo\n- quarto")).toBe(
      "- primo\n- secondo\n\n1. terzo\n- quarto",
    );
  });

  it("keeps the label of links and drops their targets", () => {
    expect(markdownToPlainText("Vedi [la fonte](https://example.com/x) e [sito](/libri/abc).")).toBe(
      "Vedi la fonte e sito.",
    );
  });

  it("keeps timestamps and chapter references as they are", () => {
    expect(markdownToPlainText("Al [12:34] e [1:02:03] si dice, (cap. 4).")).toBe(
      "Al [12:34] e [1:02:03] si dice, (cap. 4).",
    );
  });

  it("turns timestamp links into bracketed timestamps", () => {
    expect(markdownToPlainText("Guarda [12:34](https://youtu.be/abc?t=754).")).toBe("Guarda [12:34].");
  });

  it("collapses runs of blank lines and trims the ends", () => {
    expect(markdownToPlainText("\n\nUno\n\n\n\nDue   \n")).toBe("Uno\n\nDue");
  });

  it("unescapes backslash-escaped Markdown characters", () => {
    expect(markdownToPlainText("Prezzo \\* 2 \\_ non emphasis")).toBe("Prezzo * 2 _ non emphasis");
  });
});
