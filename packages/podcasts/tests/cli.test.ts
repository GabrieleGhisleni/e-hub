import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_CODES } from "../src/core/errors";
import { DATA_DIR_ENV, REPO_ROOT } from "../src/core/paths";
import { readConversations, readEpisode, writeTranscriptFile } from "../src/core/store";
import { TRANSCRIPT_EXCERPT_PLACEHOLDER } from "../src/core/transcript-guard";
import {
  compactMarkdownExport,
  seedEpisode,
  syntheticTranscript,
  toProse,
  useTempDirs,
} from "./helpers";

const dirs = useTempDirs();
const SLUG = "demo-show-first-episode";
const TSX = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

function run(
  script: string,
  args: string[],
  stdin?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [path.join(REPO_ROOT, "src", "cli", script), ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, [DATA_DIR_ENV]: dirs.data },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(stdin ?? "");
  });
}

async function inputFile(value: unknown): Promise<string> {
  const file = path.join(dirs.root, `input-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(file, JSON.stringify(value));
  return file;
}

describe("pnpm episode save (CLI)", { timeout: 30_000 }, () => {
  it("saves, then dedupes, then rejects a stale --expected-updated-at", async () => {
    const before = await seedEpisode();
    const input = await inputFile({
      notes: "From the CLI.",
      tags: ["Sleep", "AI"],
      conversations: [{ agent: "claude.ai", markdown: "Hello." }],
    });

    const first = await run("episode.ts", [
      "save",
      SLUG,
      "--input",
      input,
      "--expected-updated-at",
      before.updatedAt,
    ]);
    expect(first.code).toBe(EXIT_CODES.ok);
    expect(first.stdout).toContain(`Saved ${SLUG}`);
    expect(first.stdout).toContain("fields changed: notes, tags");
    expect(first.stdout).toContain("conversations: 1 added, 0 skipped");

    const second = await run("episode.ts", ["save", SLUG, "--input", input, "--json"]);
    expect(second.code).toBe(EXIT_CODES.ok);
    expect(JSON.parse(second.stdout)).toMatchObject({
      written: false,
      conversations: { added: 0, skipped: 1 },
    });
    expect(await readConversations(SLUG)).toHaveLength(1);

    const stale = await run("episode.ts", [
      "save",
      SLUG,
      "--input",
      input,
      "--expected-updated-at",
      before.updatedAt,
    ]);
    expect(stale.code).toBe(EXIT_CODES.conflict);
    expect(stale.stderr).toContain("modified in the meantime");
  });

  it("reads --input - from stdin and reports validation errors with exit code 3", async () => {
    await seedEpisode();
    const ok = await run(
      "episode.ts",
      ["save", SLUG, "--input", "-"],
      JSON.stringify({ guests: ["A", "B"] }),
    );
    expect(ok.code).toBe(EXIT_CODES.ok);
    expect((await readEpisode(SLUG)).guests).toEqual(["A", "B"]);

    const bad = await run(
      "episode.ts",
      ["save", SLUG, "--input", "-"],
      JSON.stringify({ summary: "not a list", extra: 1 }),
    );
    expect(bad.code).toBe(EXIT_CODES.validation);
    expect(bad.stderr).toContain('Unrecognized key: "extra"');
    expect(bad.stderr).toContain("summary:");

    const notJson = await run("episode.ts", ["save", SLUG, "--input", "-"], "{oops");
    expect(notJson.code).toBe(EXIT_CODES.validation);
  });

  it("removes excerpts from conversations and rejects them in notes (exit 6)", async () => {
    await seedEpisode();
    const { transcript, words } = syntheticTranscript(1500);
    await writeTranscriptFile(SLUG, transcript);

    const conversation = await inputFile({
      conversations: [
        {
          agent: "claude-code",
          markdown: `Context:\n\n${compactMarkdownExport(transcript)}\n\nMy question.`,
        },
      ],
    });
    const saved = await run("episode.ts", ["save", SLUG, "--input", conversation]);
    expect(saved.code).toBe(EXIT_CODES.ok);
    expect(saved.stdout).toContain("transcript excerpts removed: 1");
    expect((await readConversations(SLUG))[0]!.markdown).toContain(TRANSCRIPT_EXCERPT_PLACEHOLDER);

    const notes = await inputFile({ notes: `He said: ${toProse(words.slice(50, 75))}` });
    const rejected = await run("episode.ts", ["save", SLUG, "--input", notes]);
    expect(rejected.code).toBe(EXIT_CODES["transcript-guard"]);
    expect(rejected.stderr).toMatch(/notes: 25 consecutive words from the transcript, starting "/);
  });

  it("exit codes for usage errors and unknown episodes", async () => {
    expect((await run("episode.ts", [])).code).toBe(EXIT_CODES.usage);
    expect((await run("episode.ts", ["save", SLUG])).code).toBe(EXIT_CODES.usage);
    expect((await run("episode.ts", ["save", SLUG, "--input", "/nonexistent.json"])).code).toBe(
      EXIT_CODES.usage,
    );
    expect((await run("episode.ts", ["frobnicate"])).code).toBe(EXIT_CODES.usage);
    const missing = await run("episode.ts", ["save", "missing-episode", "--input", "-"], "{}");
    expect(missing.code).toBe(EXIT_CODES["not-found"]);
  });
});

describe("pnpm tags (CLI)", { timeout: 30_000 }, () => {
  it("lists tags with counts, most used first", async () => {
    await seedEpisode({ tags: ["sleep", "dopamine"] });
    await seedEpisode({ slug: "demo-show-second", url: "https://example.com/2", tags: ["sleep"] });
    const plain = await run("tags.ts", []);
    expect(plain.code).toBe(0);
    expect(plain.stdout).toBe("sleep\t2\ndopamine\t1\n");
    const json = await run("tags.ts", ["--json"]);
    expect(JSON.parse(json.stdout)).toEqual([
      { tag: "sleep", count: 2 },
      { tag: "dopamine", count: 1 },
    ]);
  });

  it("prints nothing for an empty catalogue", async () => {
    const result = await run("tags.ts", []);
    expect(result).toMatchObject({ code: 0, stdout: "" });
  });
});
