# W4b — `elib text <id>` + study skill

Status: done (started 2026-11-10)

## Checklist

- [x] Read contracts, PLAN §5/9/11/11-bis/12/14, cache/drive/epub/test helpers
- [x] `src/node/text/` : epub structure (spine, nav/NCX), html→md (turndown), chapter split, writer, guard, `extractBookText`
- [x] `src/node/cli/commands/text.ts` — rewritten by the orchestrator as a `CliCommand` (`textCommand`) registered in `commands/index.ts`
- [x] `.claude/skills/study/SKILL.md`
- [x] Tests `test/node/text/`
- [x] typecheck / lint / format / vitest
- [x] Report

## Decisions

- turndown: `remove(script, style)`, img → alt, links → text only (no hrefs), noteref → `[n]`.
- Fragment splitting: marker paragraph inserted before the element with the matching id in the XHTML string, split after conversion.

- `elib text` registration: done by the orchestrator (`textCommand` in `src/node/cli/commands/index.ts`); test uses `runCli`.
- Tests: 21 in test/node/text (structure, extract, command, guard). typecheck/lint/format clean.
