/** Client for the local write server (`src/server/`). Dev only. */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: string[];
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `Errore ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = typeof body.code === "string" ? body.code : "unknown";
    this.details = Array.isArray(body.details) ? body.details.map(String) : [];
    this.body = body;
  }

  get isConflict(): boolean {
    return this.status === 409 && this.code === "conflict";
  }
}

async function parseError(response: Response): Promise<ApiError> {
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = { error: `Il server ha risposto con ${response.status}.`, code: "unknown" };
  }
  return new ApiError(response.status, body);
}

export async function apiJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: "Server locale non raggiungibile.", code: "offline" });
  }
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

export async function apiText(path: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(path);
  } catch {
    throw new ApiError(0, { error: "Server locale non raggiungibile.", code: "offline" });
  }
  if (!response.ok) throw await parseError(response);
  return response.text();
}

/** Message for a failed call, details included (one per line). */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return [error.message, ...error.details].join("\n");
  }
  return error instanceof Error ? error.message : String(error);
}

// --- Response shapes (mirror src/server/app.ts and src/core/ingest) ---

export interface FeedCandidate {
  feedUrl: string;
  title: string;
  author: string;
  artworkUrl?: string;
  episodeCount?: number;
  match: "exact" | "partial" | "weak";
}

export type ShowPreview =
  | { status: "existing"; slug: string; name: string }
  | {
      status: "new";
      slug: string;
      name: string;
      host: string;
      known: boolean;
      feedUrl?: string;
      avatarUrl?: string;
      feedCandidates: FeedCandidate[];
      needsFeedDecision: boolean;
    };

export type AddPreview =
  | {
      status: "duplicate";
      existing: { slug: string; title: string; show: string };
      warnings: string[];
    }
  | {
      status: "ready";
      source: "lex" | "huberman" | "youtube";
      url: string;
      episode: { title: string; guests: string[]; number?: number; publishedAt?: string };
      show: ShowPreview;
      transcript: { status: "available"; source: string } | { status: "none"; reason: string };
      warnings: string[];
    };

export type AddResult =
  | {
      status: "duplicate";
      existing: { slug: string; title: string; show: string };
      warnings: string[];
    }
  | {
      status: "created";
      episode: { slug: string; title: string };
      show: { slug: string; name: string; created: boolean };
      transcript: { status: "saved"; segments: number } | { status: "none"; reason: string };
      warnings: string[];
    };

export interface SpeakerInfo {
  speaker: string;
  segments: number;
  firstStart: number;
}

export interface SpeakersResponse {
  available: boolean;
  source?: string;
  timebase?: string;
  speakers: SpeakerInfo[];
}

export interface SaveResponse {
  written: boolean;
  updatedAt: string;
  changedFields: string[];
}

export interface ConversationResponse {
  updatedAt: string;
  conversations: { added: number; skipped: number; excerptsRemoved: number };
  transcriptChecked: boolean;
}

const episodeBase = (slug: string) => `/api/podcasts/episodes/${encodeURIComponent(slug)}`;

export const api = {
  preview: (url: string) => apiJson<AddPreview>("POST", "/api/podcasts/episodes/preview", { url }),
  add: (url: string, feed: string | null | undefined) =>
    apiJson<AddResult>(
      "POST",
      "/api/podcasts/episodes",
      feed === undefined ? { url } : { url, feed },
    ),
  save: (
    slug: string,
    body: {
      expectedUpdatedAt: string;
      summary?: string[];
      notes?: string;
      tags?: string[];
      guests?: string[];
    },
  ) => apiJson<SaveResponse>("PUT", episodeBase(slug), body),
  addConversation: (
    slug: string,
    body: { agent: string; markdown: string; expectedUpdatedAt?: string },
  ) => apiJson<ConversationResponse>("POST", `${episodeBase(slug)}/conversations`, body),
  speakers: (slug: string) =>
    apiJson<SpeakersResponse>("GET", `${episodeBase(slug)}/transcript/speakers`),
  renameSpeakers: (slug: string, mapping: Record<string, string>) =>
    apiJson<SpeakersResponse>("POST", `${episodeBase(slug)}/transcript/speakers`, { mapping }),
  exportMarkdown: (slug: string) => apiText(`${episodeBase(slug)}/transcript.md`),
};
