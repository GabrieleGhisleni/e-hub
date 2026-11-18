/**
 * Z-Library contract (local server only). The server talks to Z-Library's `/eapi` with the session from the
 * environment; the admin UI searches the catalogue and asks the server to download a book as KEPUB or to stage it in
 * the "Aggiungi libro" flow. Ported from the KOReader plugin (zlibrary.koplugin, zlibrary/api.lua).
 */
import { z } from "zod";

export const zlibraryPaths = {
  status: "/api/library/zlibrary/status",
  /** POST {email, password}: signs in once; only the session key is kept. DELETE: forgets it. */
  session: "/api/library/zlibrary/session",
  search: "/api/library/zlibrary/search",
  /** POST: the original EPUB (attachment), e.g. for the browser to upload into an exploration. */
  epub: (id: string, hash: string) =>
    `/api/library/zlibrary/books/${encodeURIComponent(id)}/${encodeURIComponent(hash)}/epub`,
  /**
   * POST: the EPUB is downloaded and staged like an upload (`UploadResponse`). `pages` (from the search result) ends
   * up in the extracted metadata, since the EPUB itself does not carry a page count.
   */
  stage: (id: string, hash: string, pages?: number | null) =>
    `/api/library/zlibrary/books/${encodeURIComponent(id)}/${encodeURIComponent(hash)}/stage${
      pages ? `?pages=${pages}` : ""
    }`,
} as const;

export const ZLIBRARY_ORDERS = [
  { value: "bestmatch", label: "Più pertinenti" },
  { value: "popular", label: "Più popolari" },
  { value: "date", label: "Aggiunti di recente" },
  { value: "year", label: "Anno" },
  { value: "titleA", label: "Titolo (A-Z)" },
  { value: "filesizeA", label: "Peso ↑" },
  { value: "filesize", label: "Peso ↓" },
] as const;

/** The most useful subset of the API's language keys (sent verbatim). */
export const ZLIBRARY_LANGUAGES = [
  { value: "italian", label: "Italiano" },
  { value: "english", label: "Inglese" },
  { value: "french", label: "Francese" },
  { value: "german", label: "Tedesco" },
  { value: "spanish", label: "Spagnolo" },
  { value: "portuguese", label: "Portoghese" },
  { value: "latin", label: "Latino" },
  { value: "greek", label: "Greco" },
  { value: "russian", label: "Russo" },
  { value: "japanese", label: "Giapponese" },
  { value: "chinese", label: "Cinese" },
] as const;

export const ZLIBRARY_EXTENSIONS = ["EPUB", "PDF", "MOBI", "AZW3", "FB2", "DJVU", "TXT"] as const;

export const ZlibrarySearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(300),
  page: z.number().int().min(1).max(500).default(1),
  languages: z.array(z.string().regex(/^[a-z_-]+$/)).max(10).default([]),
  extensions: z.array(z.enum(ZLIBRARY_EXTENSIONS)).max(10).default(["EPUB"]),
  yearFrom: z.number().int().min(0).max(3000).optional(),
  yearTo: z.number().int().min(0).max(3000).optional(),
  /** Upper bound on the file size, in MB (filtered by the server: the API has no such parameter). */
  maxSizeMb: z.number().positive().max(2000).optional(),
  order: z.enum(ZLIBRARY_ORDERS.map((o) => o.value) as [string, ...string[]]).default("bestmatch"),
});
export type ZlibrarySearchRequest = z.input<typeof ZlibrarySearchRequestSchema>;

export const ZlibraryBookSchema = z.object({
  id: z.string(),
  hash: z.string(),
  title: z.string(),
  author: z.string(),
  year: z.number().nullable(),
  extension: z.string(),
  /** Bytes, when the API reports it. */
  size: z.number().nullable(),
  sizeLabel: z.string().nullable(),
  language: z.string().nullable(),
  publisher: z.string().nullable(),
  cover: z.string().nullable(),
  description: z.string().nullable(),
  pages: z.number().nullable(),
  isbn: z.string().nullable(),
});
export type ZlibraryBook = z.infer<typeof ZlibraryBookSchema>;

export const ZlibrarySearchResponseSchema = z.object({
  books: z.array(ZlibraryBookSchema),
  page: z.number(),
  /** Total pages reported by the API (null when unknown). */
  totalPages: z.number().nullable(),
  totalItems: z.number().nullable(),
  /** Results on this page dropped by the size/year filters. */
  filteredOut: z.number(),
});
export type ZlibrarySearchResponse = z.infer<typeof ZlibrarySearchResponseSchema>;

export const ZlibraryStatusResponseSchema = z.object({
  configured: z.boolean(),
  /** The connected Z-Library account (null if unknown). */
  account: z.string().nullable().default(null),
  baseUrl: z.string().nullable(),
  /** Downloads used / allowed today, when the session works. */
  quota: z.object({ today: z.number(), limit: z.number() }).nullable(),
  error: z.string().nullable(),
});
export type ZlibraryStatusResponse = z.infer<typeof ZlibraryStatusResponseSchema>;

export const ZlibraryLoginRequestSchema = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(500),
});
export type ZlibraryLoginRequest = z.infer<typeof ZlibraryLoginRequestSchema>;
