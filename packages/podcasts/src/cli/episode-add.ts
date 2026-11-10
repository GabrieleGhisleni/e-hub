/**
 * `pnpm episode add <url> [--added-at <date>] [--feed <url> | --no-feed] [--yes] [--json]`
 * (DESIGN.md §5, §6). Kept apart from episode.ts so tests can run it
 * in-process with a fake network (`io.deps`).
 *
 * Interactive by default: a new show with podcast feed candidates asks which
 * feed to use (or none). Non-interactive (agents/skills): `--feed` /
 * `--no-feed`, or `--yes` to accept the defaults (no feed: a feed is never
 * accepted automatically). Without a TTY and without those flags, a needed
 * confirmation fails with exit code 2 and says which flag to pass.
 *
 * Exit codes: 0 added, 7 already present (not an error: prints the existing
 * slug), 2 usage / confirmation needed, 3 validation (unsupported URL, bad
 * date or feed), 4 not found, 1 network or unexpected errors.
 */
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { normalizeAddedAt } from "../core/episodes";
import { CoreError, EXIT_CODES, exitCodeFor } from "../core/errors";
import {
  addEpisode,
  HttpError,
  previewAdd,
  type AddResult,
  type FeedCandidate,
  type IngestDeps,
} from "../core/ingest";

export const ADD_USAGE = `  pnpm episode add <url> [--added-at <YYYY-MM-DD>] [--feed <url> | --no-feed] [--yes] [--json]
      Add an episode from a lexfridman.com, hubermanlab.com or YouTube URL (creates the show if new).
      --added-at  only for the initial import of already-listened episodes
      --feed/--no-feed  confirm a podcast feed for a new show, or none; --yes accepts defaults (no feed)`;

export interface AddIo {
  deps?: IngestDeps;
  out?: (line: string) => void;
  err?: (line: string) => void;
  /** Asks a question on the terminal; absent when stdin is not a TTY. */
  ask?: (question: string) => Promise<string>;
}

function describeCandidates(candidates: FeedCandidate[]): string[] {
  return candidates.map((candidate, index) => {
    const count = candidate.episodeCount ? `, ${candidate.episodeCount} episodes` : "";
    return `  ${index + 1}) ${candidate.title} — ${candidate.author}${count} [${candidate.match} match]\n     ${candidate.feedUrl}`;
  });
}

function describeDuplicate(result: {
  existing: { slug: string; title: string };
  matchedBy: string;
}) {
  const title = result.existing.title ? ` — ${result.existing.title}` : "";
  return `Already added: ${result.existing.slug}${title} (same ${result.matchedBy === "youtubeId" ? "YouTube video" : "URL"}); nothing changed.`;
}

function describeCreated(result: Extract<AddResult, { status: "created" }>): string[] {
  const { episode, show, transcript } = result;
  const lines = [`Added ${episode.slug}`, `  title: ${episode.title}`];
  let showLine = `  show: ${show.slug} (${show.name})`;
  if (show.created) showLine += ` — new show, feed: ${show.feedUrl ?? "none (YouTube only)"}`;
  lines.push(showLine);
  if (episode.guests.length) lines.push(`  guests: ${episode.guests.join(", ")}`);
  if (episode.number) lines.push(`  number: ${episode.number}`);
  if (episode.publishedAt) lines.push(`  published: ${episode.publishedAt}`);
  if (episode.youtubeId) lines.push(`  youtube: ${episode.youtubeId}`);
  if (transcript.status === "saved") {
    const estimated = transcript.estimatedStarts ? ", some starts interpolated" : "";
    lines.push(
      `  transcript: ${transcript.source} (timebase ${transcript.timebase}), ${transcript.segments} segments, ${transcript.chapters} chapters${estimated}`,
    );
  } else {
    lines.push(
      `  transcript: nessuna trascrizione (${transcript.reason})`,
      `    to transcribe locally: pnpm transcribe ${episode.slug}`,
    );
  }
  return lines;
}

function jsonResult(result: AddResult): unknown {
  if (result.status === "duplicate")
    return {
      status: "duplicate",
      slug: result.existing.slug,
      matchedBy: result.matchedBy,
      warnings: result.warnings,
    };
  return {
    status: "created",
    slug: result.episode.slug,
    title: result.episode.title,
    show: result.show,
    guests: result.episode.guests,
    number: result.episode.number,
    publishedAt: result.episode.publishedAt,
    youtubeId: result.episode.youtubeId,
    transcript: result.transcript,
    warnings: result.warnings,
  };
}

/** Parses the answer to the feed question: empty/0/n = none, 1..N = candidate, or a URL. */
function parseFeedAnswer(answer: string, candidates: FeedCandidate[]): string | null | undefined {
  const text = answer.trim();
  if (text === "" || text === "0" || /^n(o|one)?$/i.test(text)) return null;
  if (/^\d+$/.test(text)) return candidates[Number(text) - 1]?.feedUrl;
  if (/^https?:\/\//.test(text)) return text;
  return undefined;
}

export async function runAdd(args: string[], io: AddIo = {}): Promise<number> {
  const out = io.out ?? ((line: string) => console.log(line));
  const err = io.err ?? ((line: string) => console.error(line));
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        "added-at": { type: "string" },
        feed: { type: "string" },
        "no-feed": { type: "boolean", default: false },
        yes: { type: "boolean", short: "y", default: false },
        json: { type: "boolean", default: false },
      },
    });
    const [url, ...rest] = positionals;
    if (!url || rest.length > 0) {
      err(`error: add needs exactly one <url>\n\nUsage:\n${ADD_USAGE}`);
      return EXIT_CODES.usage;
    }
    if (values.feed !== undefined && values["no-feed"]) {
      err(`error: --feed and --no-feed are mutually exclusive\n\nUsage:\n${ADD_USAGE}`);
      return EXIT_CODES.usage;
    }
    const addedAt = values["added-at"];
    if (addedAt !== undefined) normalizeAddedAt(addedAt); // fail fast, before any network access
    let feed: string | null | undefined = values["no-feed"] ? null : values.feed;
    const deps: IngestDeps = { progress: (message) => err(message), ...io.deps };

    const preview = await previewAdd(url, deps);
    if (preview.status === "duplicate") {
      if (values.json)
        out(
          JSON.stringify({
            status: "duplicate",
            slug: preview.existing.slug,
            matchedBy: preview.matchedBy,
            warnings: [],
          }),
        );
      else out(describeDuplicate(preview));
      return EXIT_CODES.duplicate;
    }

    const show = preview.show;
    if (show.status === "new" && show.needsFeedDecision && feed === undefined) {
      const intro = [
        `New show: ${show.name} (${show.youtubeAuthorUrl ?? "no channel"})`,
        "Podcast feed candidates from iTunes Search (the match is uncertain: confirm only if it is the same show):",
        ...describeCandidates(show.feedCandidates),
      ];
      if (values.yes) {
        feed = null;
        err(
          `${intro.join("\n")}\n--yes: no feed (default). Re-run with --feed <url> to choose one.`,
        );
      } else if (io.ask) {
        err(intro.join("\n"));
        let answer: string | null | undefined;
        do {
          answer = parseFeedAnswer(
            await io.ask(
              `Feed to use [1-${show.feedCandidates.length}, a URL, or 0/Enter = none]: `,
            ),
            show.feedCandidates,
          );
        } while (answer === undefined);
        feed = answer;
      } else {
        err(
          [
            ...intro,
            "error: a feed decision is needed and stdin is not a terminal.",
            "Pass --feed <url> to confirm a feed, --no-feed for none, or --yes to accept the default (no feed).",
          ].join("\n"),
        );
        return EXIT_CODES.usage;
      }
    }

    const result = await addEpisode(url, { addedAt, feed }, deps);
    if (values.json) out(JSON.stringify(jsonResult(result)));
    else if (result.status === "duplicate") out(describeDuplicate(result));
    else out(describeCreated(result).join("\n"));
    if (!values.json) for (const warning of result.warnings) err(`warning: ${warning}`);
    return result.status === "duplicate" ? EXIT_CODES.duplicate : EXIT_CODES.ok;
  } catch (error) {
    if ((error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      err(`error: ${(error as Error).message}\n\nUsage:\n${ADD_USAGE}`);
      return EXIT_CODES.usage;
    }
    if (error instanceof CoreError) {
      err(`error (${error.code}): ${error.describe()}`);
      return exitCodeFor(error);
    }
    if (error instanceof HttpError) {
      err(`network error: ${error.message} (nothing was saved; retry later)`);
      return EXIT_CODES.unexpected;
    }
    throw error;
  }
}

/** I/O for the real terminal: prompts only when stdin is a TTY. */
export function terminalAddIo(): AddIo {
  if (!process.stdin.isTTY) return {};
  return {
    ask: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
  };
}
