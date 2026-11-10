/**
 * `pnpm episode add` — `runAdd` run in-process with a fake network, plus one
 * real spawn for argument errors (no network involved).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { runAdd, type AddIo } from "../../src/cli/episode-add";
import { EXIT_CODES } from "../../src/core/errors";
import { DATA_DIR_ENV, REPO_ROOT } from "../../src/core/paths";
import { readShow } from "../../src/core/store";
import { listFilesRecursive, useTempDirs } from "../helpers";
import {
  fakeFetch,
  fakeGit,
  fixture,
  itunesSearchUrl,
  oembed,
  oembedUrl,
  pngBytes,
  watchPage,
  type FakeFetch,
} from "./fakes";

const dirs = useTempDirs();
const ID = "GnGnGnGnGn1";
const URL = `https://www.youtube.com/watch?v=${ID}`;
const SLUG = "sam-host-ada-example-thinking-about-thinking";
let net: FakeFetch;

beforeEach(async () => {
  const png = await pngBytes();
  net = fakeFetch({
    [oembedUrl(ID)]: oembed(
      "Ada Example — Thinking about thinking | Sam Host",
      "Sam Host",
      "https://www.youtube.com/@samhost",
    ),
    [URL]: watchPage({ date: "2026-09-25T10:00:00-07:00" }),
    "https://www.youtube.com/@samhost": `<meta property="og:image" content="https://yt3.example.com/avatar">`,
    "https://yt3.example.com/avatar": png,
    [itunesSearchUrl("Sam Host")]: await fixture("itunes-search.json"),
    "https://feeds.example.com/example-talks.rss": await fixture("generic-feed.xml"),
    "https://img.example.com/example-talks.jpg": png,
  });
});

async function run(args: string[], answers?: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: AddIo = {
    deps: { fetch: net.fetch, git: fakeGit().git, now: () => new Date("2026-11-10T08:00:00.000Z") },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    ask: answers ? async () => answers.shift() ?? "" : undefined,
  };
  const code = await runAdd(args, io);
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

describe("episode add (CLI)", () => {
  it("without a TTY, a needed feed decision fails with exit 2 and names the flags", async () => {
    const result = await run([URL]);
    expect(result.code).toBe(EXIT_CODES.usage);
    expect(result.stderr).toContain("https://feeds.example.com/example-talks.rss");
    expect(result.stderr).toContain("--feed <url>");
    expect(result.stderr).toContain("--no-feed");
    expect(await listFilesRecursive(dirs.root)).toEqual([]);
  });

  it("--no-feed adds the episode and reports the missing transcript", async () => {
    const result = await run([URL, "--no-feed", "--added-at", "2024-05-01"]);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.stdout).toContain(`Added ${SLUG}`);
    expect(result.stdout).toContain(
      "show: sam-host (Sam Host) — new show, feed: none (YouTube only)",
    );
    expect(result.stdout).toContain("guests: Ada Example");
    expect(result.stdout).toContain("published: 2026-09-25");
    expect(result.stdout).toContain("transcript: nessuna trascrizione");
    expect(result.stdout).toContain(`pnpm transcribe ${SLUG}`);

    const again = await run([`https://youtu.be/${ID}`]);
    expect(again.code).toBe(EXIT_CODES.duplicate);
    expect(again.stdout).toContain(`Already added: ${SLUG}`);
  });

  it("--yes accepts the default (no feed); --json prints a machine-readable result", async () => {
    const result = await run([URL, "--yes", "--json"]);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "created",
      slug: SLUG,
      show: { slug: "sam-host", created: true },
      transcript: { status: "none" },
    });
    expect(result.stderr).toContain("--yes: no feed");
    const duplicate = await run([URL, "--json"]);
    expect(duplicate.code).toBe(EXIT_CODES.duplicate);
    expect(JSON.parse(duplicate.stdout)).toMatchObject({
      status: "duplicate",
      slug: SLUG,
      matchedBy: "youtubeId",
    });
  });

  it("interactive: asks again on a bad answer, then uses the chosen candidate", async () => {
    const result = await run([URL], ["maybe", "1"]);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.stderr).toContain("1) Example Talks — Sam Host, 145 episodes [exact match]");
    expect((await readShow("sam-host")).feedUrl).toBe(
      "https://feeds.example.com/example-talks.rss",
    );
  });

  it("--feed confirms any feed URL", async () => {
    const result = await run([URL, "--feed", "https://feeds.example.com/example-talks.rss"]);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.stdout).toContain("feed: https://feeds.example.com/example-talks.rss");
  });

  it("maps errors to exit codes", async () => {
    expect((await run([])).code).toBe(EXIT_CODES.usage);
    expect((await run([URL, "--feed", "https://x.example.com/f.rss", "--no-feed"])).code).toBe(
      EXIT_CODES.usage,
    );
    expect((await run([URL, "--bogus"])).code).toBe(EXIT_CODES.usage);
    const badDate = await run([URL, "--added-at", "yesterday"]);
    expect(badDate.code).toBe(EXIT_CODES.validation);
    expect(net.calls).toEqual([]); // rejected before any network access
    expect((await run(["https://example.com/podcast/1"])).code).toBe(EXIT_CODES.validation);
    expect((await run(["https://youtu.be/MiSsInGvId0"])).code).toBe(EXIT_CODES["not-found"]);
    net.routes.set(oembedUrl(ID), { error: "getaddrinfo ENOTFOUND" });
    const offline = await run([URL, "--no-feed"]);
    expect(offline.code).toBe(EXIT_CODES.unexpected);
    expect(offline.stderr).toContain("network error");
  });

  it(
    "is wired into `pnpm episode add` (argument errors, no network)",
    { timeout: 30_000 },
    async () => {
      const result = await new Promise<{ code: number; stderr: string }>((resolve, reject) => {
        const child = spawn(
          path.join(REPO_ROOT, "node_modules", ".bin", "tsx"),
          [path.join(REPO_ROOT, "src", "cli", "episode.ts"), "add"],
          {
            cwd: REPO_ROOT,
            env: { ...process.env, [DATA_DIR_ENV]: dirs.data },
          },
        );
        let stderr = "";
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
        child.stdin.end();
      });
      expect(result.code).toBe(EXIT_CODES.usage);
      expect(result.stderr).toContain("add needs exactly one <url>");
    },
  );
});
