// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeEpisode, makeShow } from "@podcasts/testing/fixtures";
import { episodeImageCandidates, isYoutubePlaceholder, showImageUrl } from "@podcasts/lib/images";
import { EpisodeImage } from "./episode-image";

afterEach(cleanup);

const show = makeShow({ slug: "alpha" });
const BASE = "/podcasts/";
const MAXRES = "https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg";
const HQ = "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg";
const SHOW = "/podcasts/shows/alpha.webp";

describe("episodeImageCandidates", () => {
  const withVideo = makeEpisode({ slug: "x", youtubeId: "abcdefghijk" });
  const withoutVideo = makeEpisode({ slug: "y" });
  const srcs = (...args: Parameters<typeof episodeImageCandidates>) =>
    episodeImageCandidates(...args).map((candidate) => `${candidate.kind}:${candidate.src}`);

  it("list: hqdefault, then the show image", () => {
    expect(srcs(withVideo, show, "list", BASE)).toEqual([`thumbnail:${HQ}`, `show:${SHOW}`]);
  });

  it("detail: maxresdefault, then hqdefault, then the show image", () => {
    expect(srcs(withVideo, show, "detail", BASE)).toEqual([
      `thumbnail:${MAXRES}`,
      `thumbnail:${HQ}`,
      `show:${SHOW}`,
    ]);
  });

  it("without a video or a show image", () => {
    expect(srcs(withoutVideo, show, "detail", BASE)).toEqual([`show:${SHOW}`]);
    expect(srcs(withoutVideo, undefined, "list", BASE)).toEqual([]);
    expect(srcs(withoutVideo, makeShow({ slug: "z", image: undefined }), "list", BASE)).toEqual([]);
  });

  it("resolves the show image against the site base", () => {
    expect(showImageUrl(show, "/podcasts")).toBe(SHOW);
    expect(showImageUrl(show, "/")).toBe("/shows/alpha.webp");
  });

  it("recognises YouTube's 120×90 'missing thumbnail' image", () => {
    expect(isYoutubePlaceholder(MAXRES, 120)).toBe(true);
    expect(isYoutubePlaceholder(MAXRES, 1280)).toBe(false);
    expect(isYoutubePlaceholder(SHOW, 120)).toBe(false);
  });
});

describe("<EpisodeImage>", () => {
  const candidates = episodeImageCandidates(
    makeEpisode({ slug: "x", youtubeId: "abcdefghijk" }),
    show,
    "detail",
    BASE,
  );
  const mainImage = (container: HTMLElement) =>
    container.querySelector<HTMLImageElement>("img:not([aria-hidden])");

  it("falls back on error: maxres → hq → show image → placeholder", () => {
    const { container } = render(<EpisodeImage candidates={candidates} alt="" />);
    expect(mainImage(container)).toHaveAttribute("src", MAXRES);

    fireEvent.error(mainImage(container)!);
    expect(mainImage(container)).toHaveAttribute("src", HQ);

    fireEvent.error(mainImage(container)!);
    expect(container.querySelector("[data-image-kind]")).toHaveAttribute("data-image-kind", "show");
    expect(mainImage(container)).toHaveAttribute("src", SHOW);

    fireEvent.error(mainImage(container)!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-image-kind]")).toHaveAttribute(
      "data-image-kind",
      "placeholder",
    );
  });

  it("skips a YouTube placeholder that loads instead of failing", () => {
    const { container } = render(<EpisodeImage candidates={candidates} alt="" />);
    const image = mainImage(container)!;
    Object.defineProperty(image, "naturalWidth", { value: 120, configurable: true });
    fireEvent.load(image);
    expect(mainImage(container)).toHaveAttribute("src", HQ);

    const hq = mainImage(container)!;
    Object.defineProperty(hq, "naturalWidth", { value: 480, configurable: true });
    fireEvent.load(hq);
    expect(mainImage(container)).toHaveAttribute("src", HQ);
  });

  it("restarts the chain when the candidates change", () => {
    const { container, rerender } = render(<EpisodeImage candidates={candidates} alt="" />);
    fireEvent.error(mainImage(container)!);
    expect(mainImage(container)).toHaveAttribute("src", HQ);
    const other = episodeImageCandidates(
      makeEpisode({ slug: "y", youtubeId: "zyxwvutsrqp" }),
      show,
      "list",
      BASE,
    );
    rerender(<EpisodeImage candidates={other} alt="" />);
    expect(mainImage(container)).toHaveAttribute(
      "src",
      "https://i.ytimg.com/vi/zyxwvutsrqp/hqdefault.jpg",
    );
  });
});
