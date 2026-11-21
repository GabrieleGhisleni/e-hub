/**
 * Podcast routes over core and ingest, shared by Vite dev and the authenticated API.
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { ConflictError } from "../core/errors";
import { extractYoutubeId } from "../core/urls";
import { importTranscript, TranscriptChoice } from "../core/transcript-import";
import { createTranscriptionJobs } from "./transcription-jobs";
import { transcribeWithGroq } from "./transcription";
import { isValidSlug, Transcript } from "../core/schema";
import { listSpeakers, type SpeakerInfo } from "../core/speakers";
import {
  listEpisodes,
  listShows,
  readConversations,
  readEpisode,
  readTranscriptIfExists,
  withLock,
  setEpisodeTranscript,
} from "../core/store";
import { saveEpisode } from "../core/save";
import { countTags } from "../core/tags";
import { exportTranscriptMarkdown } from "../core/transcript-export";
import { correctTranscriptSpeakers } from "../core/transcripts";
import { addEpisode, previewAdd, type IngestDeps } from "../core/ingest";
import { deleteEpisode } from "../core/episodes";
import { BadRequestError, handleError } from "./errors";
import { localOnly } from "./security";

/** Largest accepted request body (a pasted conversation can be long). */
const DEFAULT_BODY_BYTES = 8 * 1024 * 1024;

const TranscriptUpdate = z.strictObject({
  expectedUpdatedAt: z.string().min(1),
  transcript: TranscriptChoice,
});

function prepareTranscript(
  choice: z.output<typeof TranscriptChoice>,
  episode: { youtubeId?: string; title: string },
  now: Date,
  progress?: (message: string) => void,
) {
  if (choice.mode === "none") return undefined;
  if (choice.mode === "api") return transcribeWithGroq(episode, now, progress);
  return importTranscript(choice, episode.youtubeId, now);
}

const UrlBody = z.strictObject({ url: z.string().trim().min(1).max(2000) });
const AddBody = UrlBody.extend({
  transcript: TranscriptChoice.optional(),
  /** Confirmed podcast feed URL, or `null` for "no feed". Absent = not decided. */
  feed: z.string().trim().min(1).max(2000).nullable().optional(),
});
const SaveBody = z.strictObject({
  expectedUpdatedAt: z.string().min(1),
  summary: z.array(z.string()).optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  guests: z.array(z.string()).optional(),
  guestDescriptions: z.record(z.string(), z.string()).optional(),
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

/** `access`: request check (default: loopback only); the hosted server passes its own (docs/hosting.md). */
export function createApp(options: { ingest?: IngestDeps; access?: MiddlewareHandler } = {}): Hono {
  const app = new Hono();
  const ingest = options.ingest ?? {};
  const jobs = createTranscriptionJobs();
  const bodyBytes = z.coerce
    .number()
    .int()
    .positive()
    .safeParse(process.env.E_PODCASTS_MAX_BODY_BYTES);

  app.onError(handleError);
  app.notFound((c) => c.json({ error: "Endpoint inesistente.", code: "not-found" }, 404));

  app.use("/api/podcasts/*", options.access ?? localOnly);
  app.use("/api/podcasts/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use(
    "/api/podcasts/*",
    bodyLimit({
      maxSize: bodyBytes.success ? bodyBytes.data : DEFAULT_BODY_BYTES,
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

  app.get("/api/podcasts/transcription-jobs/:id", (c) => {
    const status = jobs.get(c.req.param("id"));
    const headers = { "Cache-Control": "no-store" };
    return status
      ? c.json(status, 200, headers)
      : c.json(
          { error: "Elaborazione non trovata. Riprova per riprendere.", code: "not-found" },
          404,
          headers,
        );
  });

  app.get("/api/podcasts/health", (c) => c.json({ ok: true }));

  // Read side of the hosted site: the whole catalog (shows and episodes) and the conversations of one episode.
  app.get("/api/podcasts/catalog", async (c) =>
    c.json({ shows: await listShows(), episodes: await listEpisodes() }),
  );
  app.get("/api/podcasts/episodes/:slug/conversations", async (c) => {
    const slug = c.req.param("slug");
    await readEpisode(slug);
    return c.json({ conversations: await readConversations(slug) });
  });

  // Existing tags with counts (suggestions in the editor).
  app.get("/api/podcasts/tags", async (c) => c.json(countTags(await listEpisodes())));

  // Add an episode: preview (reads the network, writes nothing), then add.
  app.post("/api/podcasts/episodes/preview", async (c) => {
    const { url } = await readBody(c, UrlBody);
    return c.json(await previewAdd(url, ingest));
  });
  app.post("/api/podcasts/episodes", async (c) => {
    const { url, feed, transcript } = await readBody(c, AddBody);
    // `addedAt` is CLI-only (initial import): never accepted from the UI.
    const add = (progress?: (message: string) => void) =>
      withLock("episodes:add", () =>
        addEpisode(
          url,
          {
            feed,
            prepareTranscript:
              transcript &&
              (async (episode, now) => prepareTranscript(transcript, episode, now, progress)),
          },
          ingest,
        ),
      );
    if (transcript?.mode === "api" && c.req.header("Prefer") === "respond-async") {
      return c.json({ jobId: jobs.start(JSON.stringify(["add", url, feed]), add) }, 202);
    }
    return c.json(await add(), 201);
  });

  // Save editable episode fields (all optional; absent = unchanged).
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

  // Remove an episode with its conversations and local transcript.
  app.delete("/api/podcasts/episodes/:slug", async (c) =>
    c.json(await deleteEpisode(c.req.param("slug"))),
  );

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

  app.get("/api/podcasts/episodes/:slug/transcript", async (c) => {
    const slug = c.req.param("slug");
    const episode = await readEpisode(slug);
    const transcript = await readTranscriptIfExists(slug);
    return c.json({ transcript: transcript ?? null, updatedAt: episode.updatedAt }, 200, {
      "Cache-Control": "no-store",
    });
  });

  app.put("/api/podcasts/episodes/:slug/transcript", async (c) => {
    const slug = c.req.param("slug");
    const { expectedUpdatedAt, transcript } = await readBody(c, TranscriptUpdate);
    const update = (progress?: (message: string) => void) =>
      withLock(`episode:${slug}`, async () => {
        const episode = await readEpisode(slug);
        if (episode.updatedAt !== expectedUpdatedAt)
          throw new ConflictError(slug, expectedUpdatedAt, episode.updatedAt);
        const result = await prepareTranscript(
          transcript,
          {
            title: episode.title,
            youtubeId: episode.youtubeId ?? extractYoutubeId(episode.url),
          },
          new Date(),
          progress,
        );
        return { episode: await setEpisodeTranscript(episode, result && Transcript.parse(result)) };
      });
    if (transcript.mode === "api" && c.req.header("Prefer") === "respond-async") {
      return c.json(
        { jobId: jobs.start(JSON.stringify(["update", slug, expectedUpdatedAt]), update) },
        202,
      );
    }
    return c.json(await update(), 200, { "Cache-Control": "no-store" });
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
