import { expect, it } from "vitest";
import { siteDataUrls } from "../../../src/shared/site-urls.ts";

it("builds URLs under the base path", () => {
  const urls = siteDataUrls("/e-library");
  expect(urls.indexUrl).toBe("/e-library/data/index.json");
  expect(urls.bookUrl("abc")).toBe("/e-library/data/books/abc.json");
  expect(urls.coverUrl("abc.1234abcd.webp")).toBe("/e-library/data/covers/abc.1234abcd.webp");
});
