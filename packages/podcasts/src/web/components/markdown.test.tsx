// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TRANSCRIPT_EXCERPT_PLACEHOLDER } from "@core/transcript-guard";
import { Markdown } from "./markdown";

afterEach(cleanup);

const NOTES = [
  "At [01:23:45] the guest argues, see also [12:30].",
  "",
  "Already linked: [00:10:00](https://example.com/x). Code: `[00:20:00]`.",
  "",
  "```",
  "[00:30:00] inside a code block",
  "```",
  "",
  "Invalid [99:99:99] stays.",
  "",
  "| a | b |",
  "| --- | --- |",
  "| x | [2:00:01] |",
].join("\n");

const links = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")]);

describe("Markdown timestamps", () => {
  it("links timestamps to the video when a video id is given", () => {
    const { container } = render(<Markdown timestampVideoId="abcdefghijk">{NOTES}</Markdown>);
    expect(links(container)).toEqual([
      ["[01:23:45]", "https://www.youtube.com/watch?v=abcdefghijk&t=5025s"],
      ["[12:30]", "https://www.youtube.com/watch?v=abcdefghijk&t=750s"],
      ["00:10:00", "https://example.com/x"],
      ["[2:00:01]", "https://www.youtube.com/watch?v=abcdefghijk&t=7201s"],
    ]);
    const timestamp = container.querySelector("a.timestamp-link");
    expect(timestamp).toHaveAttribute("target", "_blank");
    expect(timestamp).toHaveAttribute("rel", "noopener noreferrer");
    expect(container).toHaveTextContent("Invalid [99:99:99] stays.");
    expect(container.querySelector("code")).toHaveTextContent("[00:20:00]");
    expect(container.querySelector("pre")).toHaveTextContent("[00:30:00] inside a code block");
  });

  it("keeps timestamps as plain text without a video id (feed timebase / no video)", () => {
    const { container } = render(<Markdown>{NOTES}</Markdown>);
    expect(links(container)).toEqual([["00:10:00", "https://example.com/x"]]);
    expect(container).toHaveTextContent("At [01:23:45] the guest argues, see also [12:30].");
  });

  it("marks the transcript-redaction placeholder and renders no raw HTML", () => {
    const { container } = render(
      <Markdown>{`He said ${TRANSCRIPT_EXCERPT_PLACEHOLDER} and left. <script>alert(1)</script>`}</Markdown>,
    );
    const marked = container.querySelector(".redacted-excerpt");
    expect(marked).toHaveTextContent(TRANSCRIPT_EXCERPT_PLACEHOLDER);
    expect(container.querySelector("script")).toBeNull();
  });
});
