/**
 * The local write server (DESIGN.md §9): thin Hono routes over core and
 * ingest. Dev only, mounted in Vite's dev server by `src/server/index.ts`.
 */
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { isValidSlug } from "../core/schema";
import { listSpeakers, type SpeakerInfo } from "../core/speakers";
import { readEpisode, listEpisodes, readTranscriptIfExists } from "../core/store";
import { saveEpisode } from "../core/save";
import { countTags } from "../core/tags";
import { exportTranscriptMarkdown } from "../core/transcript-export";
import { correctTranscriptSpeakers } from "../core/transcripts";
import { addEpisode, previewAdd, type IngestDeps } from "../core/ingest";
import { BadRequestError, handleError } from "./errors";
import { localOnly } from "./security";

/** Largest accepted request body (a pasted conversation can be long). */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const UrlBody = z.strictObject({ url: z.string().trim().min(1).max(2000) });
const AddBody = UrlBody.extend({
  /** Confirmed podcast feed URL, or `null` for "no feed". Absent = not decided. */
  feed: z.string().trim().min(1).max(2000).nullable().optional(),
});
const SaveBody = z.strictObject({
  expectedUpdatedAt: z.string().min(1),
  summary: z.array(z.string()).optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  guests: z.array(z.string()).optional(),
});
const ConversationBody = z.strictObject({
  expectedUpdatedAt: z.string().min(1).optional(),
  agent: z.string(),
  markdown: z.string(),
  date: z.string().optional(),
});
const SpeakersBody = z.strictObject({
  mapping: z.record(z.string(), z.string()),
  from: z.number().nonnegative().optional(),
  to: z.number().nonnegative().optional(),
});

async function readBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new BadRequestError("Il corpo della richiesta non è JSON valido.");
  }
  return schema.parse(raw);
}

function speakersPayload(transcript: Awaited<ReturnType<typeof readTranscriptIfExists>>): {
  available: boolean;
  source?: string;
  timebase?: string;
  speakers: SpeakerInfo[];
} {
  if (!transcript) return { available: false, speakers: [] };
  return {
    available: true,
    source: transcript.source,
    timebase: transcript.timebase,
    speakers: listSpeakers(transcript),
  };
}

export function createApp(options: { ingest?: IngestDeps } = {}): Hono {
  const app = new Hono();
  const ingest = options.ingest ?? {};

  app.onError(handleError);
  app.notFound((c) => c.json({ error: "Endpoint inesistente.", code: "not-found" }, 404));

  app.use("/api/podcasts/*", localOnly);
  app.use(
    "/api/podcasts/*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: "Richiesta troppo grande.", code: "too-large" }, 413),
    }),
  );
  // Slugs become file paths: validate before any handler runs.
  app.use("/api/podcasts/episodes/:slug/*", async (c, next) => {
    if (!isValidSlug(c.req.param("slug"))) {
      throw new BadRequestError("Slug non valido.");
    }
    await next();
  });
  app.use("/api/podcasts/episodes/:slug", async (c, next) => {
    if (!isValidSlug(c.req.param("slug"))) {
      throw new BadRequestError("Slug non valido.");
    }
    await next();
  });

  app.get("/api/podcasts/health", (c) => c.json({ ok: true }));

  // Existing tags with counts (suggestions in the editor).
  app.get("/api/podcasts/tags", async (c) => c.json(countTags(await listEpisodes())));

  // Add an episode: preview (reads the network, writes nothing), then add.
  app.post("/api/podcasts/episodes/preview", async (c) => {
    const { url } = await readBody(c, UrlBody);
    return c.json(await previewAdd(url, ingest));
  });
  app.post("/api/podcasts/episodes", async (c) => {
    const { url, feed } = await readBody(c, AddBody);
    // `addedAt` is CLI-only (initial import): never accepted from the UI.
    return c.json(await addEpisode(url, { feed }, ingest), 201);
  });

  // Save summary / notes / tags / guests (all optional; absent = unchanged).
  app.put("/api/podcasts/episodes/:slug", async (c) => {
    const slug = c.req.param("slug");
    const { expectedUpdatedAt, ...fields } = await readBody(c, SaveBody);
    const result = await saveEpisode(slug, fields, { expectedUpdatedAt });
    return c.json({
      slug,
      written: result.written,
      updatedAt: result.episode.updatedAt,
      changedFields: result.changedFields,
      episode: result.episode,
    });
  });

  // Add one conversation; reports how many transcript excerpts were removed.
  app.post("/api/podcasts/episodes/:slug/conversations", async (c) => {
    const slug = c.req.param("slug");
    const { expectedUpdatedAt, agent, markdown, date } = await readBody(c, ConversationBody);
    const result = await saveEpisode(
      slug,
      { conversations: [{ agent, markdown, ...(date ? { date } : {}) }] },
      { expectedUpdatedAt },
    );
    return c.json({
      slug,
      updatedAt: result.episode.updatedAt,
      conversations: result.conversations,
      transcriptChecked: result.transcriptChecked,
    });
  });

  // Speakers of the local transcript, and their correction.
  app.get("/api/podcasts/episodes/:slug/transcript/speakers", async (c) => {
    const slug = c.req.param("slug");
    await readEpisode(slug);
    return c.json(speakersPayload(await readTranscriptIfExists(slug)));
  });
  app.post("/api/podcasts/episodes/:slug/transcript/speakers", async (c) => {
    const slug = c.req.param("slug");
    const { mapping, from, to } = await readBody(c, SpeakersBody);
    const transcript = await correctTranscriptSpeakers(slug, mapping, { from, to });
    return c.json(speakersPayload(transcript));
  });

  // Compact markdown export ("Copia per l'agente").
  app.get("/api/podcasts/episodes/:slug/transcript.md", async (c) => {
    const markdown = await exportTranscriptMarkdown(c.req.param("slug"));
    return c.body(markdown, 200, {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "no-store",
    });
  });

  return app;
}
