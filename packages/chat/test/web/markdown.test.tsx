// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatMarkdown } from "../../src/web/markdown.tsx";

afterEach(cleanup);

describe("ChatMarkdown", () => {
  it("renders lists, bold text and links that open in a new tab", () => {
    const { container } = render(
      <ChatMarkdown>{"- primo punto\n- **secondo** punto\n\nVedi [la fonte](https://example.com/x)."}</ChatMarkdown>,
    );

    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    expect(screen.getByText("secondo").tagName).toBe("STRONG");
    const link = screen.getByRole("link", { name: "la fonte" });
    expect(link.getAttribute("href")).toBe("https://example.com/x");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps relative links in the same tab and does not render raw HTML", () => {
    const { container } = render(<ChatMarkdown>{"[indice](/libri/abc) <script>x</script>"}</ChatMarkdown>);
    const link = screen.getByRole("link", { name: "indice" });
    expect(link.getAttribute("target")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });
});
