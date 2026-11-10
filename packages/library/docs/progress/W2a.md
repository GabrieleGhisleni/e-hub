# W2a progress — DONE

- [x] src/node/epub (`extractEpubMetadata`, `EpubError`, `normalizeIsbn`, `normalizeAuthorName`, `cleanDescription`)
- [x] src/node/covers (`toCoverWebp`, `placeholderCover`, `placeholderSvg`, `saveCover`)
- [x] src/node/openlibrary (`findOpenLibraryCover`, `findOpenLibraryCoverDetailed`, `downloadOpenLibraryCover`, `RateLimiter`)
- [x] tests: test/node/{epub,covers,openlibrary} (29 tests pass)
- [x] smoke check
- [x] typecheck, lint, oxfmt on own paths, vitest

## Decisions / deviations

- Roles: creators with no role are kept next to `aut`; if filtering leaves nothing, all creators are kept.
- `findOpenLibraryCover` returns match|null; failure reasons go to `opts.onFailure`; `findOpenLibraryCoverDetailed` returns `{match, failures[]}`.
- Placeholder download threshold: bodies < 1 KB count as "no cover".
- Quality 78 WebP: real 290 KB JPEG cover -> 55 KB.
- W1 bug (not fixed, not my area): `DEFAULT_EPUB_METADATA.isbn` "9788800000001" has an invalid checksum (valid would end in 0). My tests pass an explicit valid ISBN.
- No packages added.

## Smoke check (~/Downloads, read-only, 3 EPUBs; 2 are the same book, one is a kepub)

All three: title "Piccole abitudini per grandi cambiamenti: ...", authors ["James Clear"], lang it, publisher De Agostini,
4 subjects, description OK, ISBN not found (OPF only has uuid + calibre ids; correct), cover found (image/jpeg,
OEBPS/Images/cover.jpg, 290 KB -> 55 KB WebP; the nested-folder file has href `cover.jpeg`). Warnings: "No valid ISBN found." only.
