// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeEpisode } from "@podcasts/testing/fixtures";
import { DevSlot, type DevSlots } from "./dev-slot";

afterEach(cleanup);

// Stand-in for phase 7's module: one slot wraps its children, one throws.
vi.mock("./dev/slots", () => {
  const slots: DevSlots = {
    "episode-notes": ({ episode, children }) => (
      <div data-testid="editor">
        editor for {episode.slug}
        {children}
      </div>
    ),
    "episode-summary": () => {
      throw new Error("broken slot");
    },
  };
  return { DEV_ONLY_MARKER: "test-marker", slots };
});

describe("DevSlot (dev mode)", () => {
  const episode = makeEpisode({ slug: "alpha-sleep" });

  it("renders the default content, then the slot component around it", async () => {
    render(
      <DevSlot name="episode-notes" episode={episode}>
        <p>read-only notes</p>
      </DevSlot>,
    );
    expect(screen.getByText("read-only notes")).toBeInTheDocument();
    expect(await screen.findByTestId("editor")).toHaveTextContent("editor for alpha-sleep");
    expect(screen.getByTestId("editor")).toContainElement(screen.getByText("read-only notes"));
    expect(document.documentElement.dataset.devFeatures).toBe("test-marker");
  });

  it("falls back to the default content when a slot is missing or crashes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <>
        <DevSlot name="episode-actions" episode={episode} show={undefined}>
          <span>no slot here</span>
        </DevSlot>
        <DevSlot name="episode-summary" episode={episode}>
          <span>summary fallback</span>
        </DevSlot>
        <DevSlot name="episode-notes" episode={episode} />
      </>,
    );
    await screen.findByTestId("editor");
    expect(screen.getByText("no slot here")).toBeInTheDocument();
    expect(screen.getByText("summary fallback")).toBeInTheDocument();
  });
});
