/**
 * Minimal HTTP client of the Explore API, same origin (served by the dev server). The library package cannot import
 * @ehub/explore, so only the fields the library needs are validated here, loosely; extra fields are ignored.
 */
import { z } from "zod";

export interface ExplorationSummary {
  id: string;
  title: string;
  question: string;
  status: string;
  updatedAt?: string;
  sources: unknown[];
}

const ExplorationSchema = z.object({
  id: z.string(),
  title: z.string(),
  question: z.string(),
  status: z.string(),
  updatedAt: z.string().optional(),
  sources: z.array(z.unknown()),
});

const ExplorationListSchema = z.object({ explorations: z.array(ExplorationSchema) });

const ExploreErrorBodySchema = z.object({ error: z.string(), code: z.string() });

/** A failed Explore call: `message` is the server's own text (Italian), `code` its machine code. */
export class ExploreError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(init: { message: string; code: string; status: number }) {
    super(init.message);
    this.name = "ExploreError";
    this.code = init.code;
    this.status = init.status;
  }
}

const EXPLORE_API = "/api/explore";

async function call(url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ExploreError({
      message: "Impossibile raggiungere Explore. Controlla che il server sia avviato.",
      code: "network",
      status: 0,
    });
  }
  if (response.ok) return response;
  throw await toExploreError(response);
}

async function toExploreError(response: Response): Promise<ExploreError> {
  try {
    const parsed = ExploreErrorBodySchema.safeParse(await response.json());
    if (parsed.success) {
      return new ExploreError({
        message: parsed.data.error,
        code: parsed.data.code,
        status: response.status,
      });
    }
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return new ExploreError({
    message: `Errore di Explore (HTTP ${response.status}).`,
    code: "internal",
    status: response.status,
  });
}

async function parseBody<S extends z.ZodType>(response: Response, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ExploreError({
      message: "Risposta di Explore non valida.",
      code: "bad-response",
      status: response.status,
    });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ExploreError({
      message: "Explore ha risposto in un formato inatteso.",
      code: "bad-response",
      status: response.status,
    });
  }
  return parsed.data;
}

export async function listExplorations(signal?: AbortSignal): Promise<ExplorationSummary[]> {
  const response = await call(EXPLORE_API, {
    headers: { Accept: "application/json" },
    signal,
  });
  return (await parseBody(response, ExplorationListSchema)).explorations;
}

export async function createExploration(input: {
  title: string;
  question: string;
}): Promise<ExplorationSummary> {
  const response = await call(EXPLORE_API, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ title: input.title, question: input.question }),
  });
  return parseBody(response, ExplorationSchema);
}

/** Adds the EPUB (raw bytes) to an exploration; the server stores it and registers the book as a source. */
export async function addEpubToExploration(
  explorationId: string,
  file: File,
): Promise<ExplorationSummary> {
  const response = await call(`${EXPLORE_API}/${encodeURIComponent(explorationId)}/epub`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/epub+zip",
      "x-file-name": encodeURIComponent(file.name),
    },
    body: file,
  });
  return parseBody(response, ExplorationSchema);
}
