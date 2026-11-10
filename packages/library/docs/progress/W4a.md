# W4a — Local admin UI (upload, edit, bulk edit, delete, topics)

Status: done (started 2026-11-10)

## Checklist

- [x] 1. Read contracts/spec; progress file
- [x] 2. Pure helpers `src/web/admin/lib/*` (form<->patch diff, tags, report summary, error messages) + tests `test/web/admin/`
- [x] 3. API client `src/web/admin/api.ts` (Zod-parsed, ApiError -> Italian)
- [x] 4. Admin shell: TooltipProvider + Toaster, ReconcileReport view, shared form fields (tags input, authors input)
- [x] 5. Upload page (/admin/upload)
- [x] 6. Edit sheet + cover change (BookAdminActions)
- [x] 7. Delete dialog
- [x] 8. Bulk edit (LibraryAdminBar)
- [x] 9. Topics page (/admin/topics)
- [x] 10. typecheck / lint / format / test / build, marker + admin strings absent from dist
- [x] 11. Manual e2e in browser (temp config + temp data)
- [x] 12. Report

## Decisions / log

- Pure helpers in `src/web/admin/lib/` (tags, book-form, bulk, report, errors) use relative imports; `tsconfig.node.json` include gained `src/web/admin/lib` (same reason as W3b's `src/web/lib`). 26 tests in test/web/admin green.
- [x] 3-7 written (api.ts, chrome, report view, form fields, upload page, edit sheet, cover dialog, delete dialog); typecheck pending
- e2e env: scratchpad/e2e (data, cache, remote, rclone.conf, config; server :18788, vite :5199); epubs prova.epub, senza-cover.epub
- e2e verified: upload (busy state, files on remote), edit topic -> files moved on remote
- e2e verified in browser: upload (dup warnings, busy, cancel), edit (files moved), cover dialog, bulk (report dialog), topics add/delete, book delete, dark theme. Servers stopped.
- Gates: typecheck, lint, oxfmt on own paths, `pnpm test` (39 files / 359 tests), `pnpm build` green; marker and admin strings absent from dist/ (bundle unchanged at ~513 kB).
- Edits outside src/web/admin: src/web/admin-slots.tsx (+`AdminChromeSlot`), src/web/routes/root-layout.tsx (mounts it under `__ELIB_ADMIN__`), tsconfig.node.json (+`src/web/admin/lib`).
- Not verified: Open Library cover candidate UI ("da confermare" badge, network only) and the cover image-file upload (no file picker in the pane) — covered by unit tests / code only.
- Known nit: upload-form placeholder preview tone is keyed on the upload id, the stored placeholder on the book id (can differ in colour).
