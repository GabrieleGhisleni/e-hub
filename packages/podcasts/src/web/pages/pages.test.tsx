// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "@core/schema";
import { podcastsRoutes } from "@podcasts/entry";
import type { SiteData } from "@podcasts/site-data";
import { makeEpisode, makeShow, makeSiteData } from "@podcasts/testing/fixtures";

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(cleanup);

const shows = [
  makeShow({ slug: "alpha", name: "Alpha Show" }),
  makeShow({ slug: "beta", name: "Beta Pod" }),
];
const episodes = [
  makeEpisode({
    slug: "alpha-sleep",
    title: "Master Your Sleep",
    show: "alpha",
    guests: ["Matt Walker", "Alex Rossi"],
    guestDescriptions: { "Matt Walker": "Ricercatore che studia il sonno." },
    youtubeId: "abcdefghijk",
    transcriptSource: "lex-official",
    transcriptTimebase: "youtube",
    publishedAt: "2024-11-11",
    tags: ["sleep", "light"],
    summary: ["Light in the morning.", "No caffeine late."],
    notes: "## Light\n\nSee [01:02:03].",
    addedAt: "2026-03-01T10:00:00.000Z",
  }),
  makeEpisode({
    slug: "beta-ai",
    title: "Scaling Laws",
    show: "beta",
    tags: ["ai"],
    summary: ["Compute keeps paying off."],
    addedAt: "2026-04-01T10:00:00.000Z",
  }),
];
const conversations: Record<string, Conversation[]> = {
  "alpha-sleep": [
    {
      date: "2026-03-02T00:00:00.000Z",
      agent: "claude.ai",
      markdown: "**Me:** what about [00:10]?",
    },
  ],
};

/** Renders the module at `/podcasts<path>`; `path` is relative to the module. */
function renderAt(path: string, data: SiteData = makeSiteData(shows, episodes, conversations)) {
  const [route] = podcastsRoutes(data);
  // Shows the current location next to the module (the router's view of the URL).
  const router = createMemoryRouter(
    [
      {
        ...route!,
        element: (
          <>
            <LocationOutput />
            {route!.element}
          </>
        ),
      },
    ],
    { initialEntries: [`/podcasts${path}`] },
  );
  return render(<RouterProvider router={router} />);
}

function LocationOutput() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

const rowTitles = () =>
  screen.queryAllByRole("article").map((row) => within(row).getByRole("heading").textContent);

describe("home", () => {
  it("lists episodes newest first with their details", async () => {
    renderAt("/");
    expect(rowTitles()).toEqual(["Scaling Laws", "Master Your Sleep"]);
    const row = screen.getAllByRole("article")[1]!;
    expect(within(row).getByRole("link", { name: "Master Your Sleep" })).toHaveAttribute(
      "href",
      "/podcasts/episode/alpha-sleep/",
    );
    expect(row).toHaveTextContent("Matt Walker");
    expect(row).toHaveTextContent("Alpha Show");
    expect(row).toHaveTextContent("11 nov 2024");
    expect(row).toHaveTextContent("Light in the morning.");
    expect(row.querySelector("img")).toHaveAttribute(
      "src",
      "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
    );
    await waitFor(() => expect(document.documentElement.dataset.devFeatures).toBeDefined());
    expect(await screen.findByRole("button", { name: "Aggiungi URL" })).toBeVisible();
  });

  it("applies filters from the URL and offers to clear them", () => {
    renderAt("/?tag=sleep");
    expect(rowTitles()).toEqual(["Master Your Sleep"]);
    expect(screen.getByText("1 episodio su 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Azzera filtri" }));
    expect(rowTitles()).toEqual(["Scaling Laws", "Master Your Sleep"]);
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/podcasts\/$/);
  });

  it("searches as you type and keeps the query in the URL", () => {
    renderAt("/");
    fireEvent.change(screen.getByRole("searchbox", { name: "Cerca negli episodi" }), {
      target: { value: "scal" },
    });
    expect(rowTitles()).toEqual(["Scaling Laws"]);
    expect(screen.getByTestId("location")).toHaveTextContent("/podcasts/?q=scal");
  });

  it("toggles a tag filter from a row", () => {
    renderAt("/");
    fireEvent.click(screen.getAllByRole("button", { name: "ai" })[0]!);
    expect(screen.getByTestId("location")).toHaveTextContent("/podcasts/?tag=ai");
    expect(rowTitles()).toEqual(["Scaling Laws"]);
  });

  it("shows an empty state when nothing matches", () => {
    renderAt("/?q=zzzzzz");
    expect(rowTitles()).toEqual([]);
    expect(screen.getByRole("heading", { name: "Nessun episodio trovato" })).toBeInTheDocument();
  });

  it("invites to add the first episode when the catalog is empty (dev)", () => {
    renderAt("/", makeSiteData(shows, []));
    expect(screen.getByRole("heading", { name: "Aggiungi il primo episodio" })).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});

describe("episode page", () => {
  it("shows metadata, summary and notes with timestamp links", async () => {
    renderAt("/episode/alpha-sleep/");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Master Your Sleep");
    expect(screen.getByRole("link", { name: /Guarda su YouTube/ })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=abcdefghijk",
    );
    expect(screen.getByRole("link", { name: /Episodio originale/ })).toHaveAttribute(
      "href",
      "https://example.com/alpha-sleep",
    );
    expect(screen.getByRole("link", { name: "Matt Walker" })).toHaveAttribute(
      "href",
      "/podcasts/?q=Matt+Walker",
    );
    expect(screen.getByRole("link", { name: "sleep" })).toHaveAttribute(
      "href",
      "/podcasts/?tag=sleep",
    );
    expect(screen.getByText("Light in the morning.")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "[01:02:03]" })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=abcdefghijk&t=3723s",
    );
    expect(document.title).toBe("Master Your Sleep · e-podcasts");
  });

  it("opens and closes the guest dialog, with a description where available", async () => {
    renderAt("/episode/alpha-sleep/");
    const trigger = screen.getByRole("button", { name: /Ospiti dell.episodio/ });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: /Ospiti dell.episodio/ });
    expect(within(dialog).getByText("Ricercatore che studia il sonno.")).toBeVisible();
    expect(within(dialog).getByText("Alex Rossi")).toBeVisible();
    expect(within(dialog).getByText("Una presentazione non è ancora disponibile.")).toBeVisible();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("explains when the catalog lists no guests", () => {
    renderAt("/episode/beta-ai/");
    fireEvent.click(screen.getByRole("button", { name: /Ospiti dell.episodio/ }));
    expect(screen.getByText("Il catalogo non indica ospiti per questo episodio.")).toBeVisible();
  });

  it("loads conversations only when the section is opened", async () => {
    const load = vi.fn(async (slug: string) => conversations[slug] ?? []);
    renderAt("/episode/alpha-sleep/", makeSiteData(shows, episodes, conversations, load));
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Conversazioni/ }));
    expect(load).toHaveBeenCalledWith("alpha-sleep");
    expect(await screen.findByText("claude.ai")).toBeInTheDocument();
    expect(screen.getByText("2 marzo 2026")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "[00:10]" })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=abcdefghijk&t=10s",
    );
    // Closing and reopening does not fetch again.
    fireEvent.click(screen.getByRole("button", { name: /Conversazioni/ }));
    fireEvent.click(screen.getByRole("button", { name: /Conversazioni/ }));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reports a failed conversations load and retries", async () => {
    const load = vi
      .fn<(slug: string) => Promise<Conversation[]>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(conversations["alpha-sleep"]!);
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderAt("/episode/alpha-sleep/", makeSiteData(shows, episodes, conversations, load));
    fireEvent.click(screen.getByRole("button", { name: /Conversazioni/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Riprova/ }));
    expect(await screen.findByText("claude.ai")).toBeInTheDocument();
  });

  it("without YouTube, links the original episode and shows the empty-notes message", () => {
    renderAt("/episode/beta-ai/");
    expect(screen.queryByRole("link", { name: /YouTube/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Episodio originale/ })).toBeInTheDocument();
    expect(screen.getByText("Compute keeps paying off.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Appunti/ })).toBeNull();
  });

  it("unknown episodes and unknown paths render the not-found page", () => {
    renderAt("/episode/nope/");
    expect(screen.getByRole("heading", { name: "Episodio non trovato" })).toBeInTheDocument();
    cleanup();
    renderAt("/some/where");
    expect(screen.getByRole("heading", { name: "Pagina non trovata" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Torna agli episodi/ })).toHaveAttribute(
      "href",
      "/podcasts",
    );
  });
});
