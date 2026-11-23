/**
 * Z-Library client (port of zlibrary.koplugin/zlibrary/api.lua, only what e-hub needs): sign-in, search, download link,
 * download. Talks to the mobile-app API (`/eapi`) with the `remix_userid` / `remix_userkey` cookies.
 *
 * Configuration comes from the environment (never from the versioned elib.config.json):
 *   ZLIBRARY_BASE_URL   mirror, default https://z-library.sk
 *   ZLIBRARY_USER_ID + ZLIBRARY_USER_KEY   an existing session (preferred: no sign-in request at all), or
 *   ZLIBRARY_EMAIL + ZLIBRARY_PASSWORD     credentials; the session is then kept in `<cache>/zlibrary-session.json`.
 */
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ZlibraryBook, ZlibrarySearchRequest, ZlibrarySearchResponse } from "../../shared/zlibrary.ts";
import { ZlibrarySearchRequestSchema } from "../../shared/zlibrary.ts";

const DEFAULT_BASE_URL = "https://z-library.sk";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const PAGE_SIZE = 30;
const API_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

export type ZlibraryErrorKind = "not-configured" | "auth" | "limit" | "failed" | "wrong-format";

export class ZlibraryError extends Error {
  readonly kind: ZlibraryErrorKind;
  constructor(kind: ZlibraryErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ZlibraryError";
    this.kind = kind;
  }
}

export interface ZlibraryEnv {
  baseUrl: string;
  userId?: string;
  userKey?: string;
  email?: string;
  password?: string;
}

export function zlibraryEnvFrom(env: NodeJS.ProcessEnv = process.env): ZlibraryEnv {
  const clean = (v: string | undefined) => (v && v.trim() !== "" ? v.trim() : undefined);
  return {
    baseUrl: (clean(env.ZLIBRARY_BASE_URL) ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    userId: clean(env.ZLIBRARY_USER_ID),
    userKey: clean(env.ZLIBRARY_USER_KEY),
    email: clean(env.ZLIBRARY_EMAIL),
    password: env.ZLIBRARY_PASSWORD || undefined,
  };
}

interface Session {
  userId: string;
  userKey: string;
}

export interface DownloadedFile {
  bytes: Uint8Array;
  extension: string;
  /** "Author - Title" (unsanitized). */
  displayName: string;
}

export class ZlibraryClient {
  private env: ZlibraryEnv;
  private readonly sessionFile: string;
  private session: Session | null = null;
  private savedEmail: string | undefined;
  private loginInFlight: Promise<Session> | null = null;
  /** Who produced the next saved session: the user typing credentials in the app, or the environment. */
  private loginSource: "ui" | "env" = "env";

  constructor(env: ZlibraryEnv, cacheDir: string) {
    this.env = env;
    this.sessionFile = path.join(cacheDir, "zlibrary-session.json");
    if (env.userId && env.userKey) this.session = { userId: env.userId, userKey: env.userKey };
  }

  get configured(): boolean {
    return Boolean(
      this.session ||
        (this.env.userId && this.env.userKey) ||
        (this.env.email && this.env.password),
    );
  }

  /**
   * Loads the saved session from disk (per-user hosted setup: no credentials in the environment, the user signed in
   * once with `connect`). Call before reading `configured`.
   */
  async restore(): Promise<void> {
    if (this.session) return;
    try {
      const saved = JSON.parse(await readFile(this.sessionFile, "utf8")) as Partial<Session> & {
        email?: string;
        source?: string;
      };
      if (!saved.userId || !saved.userKey) return;
      // A session the user created in the app wins over the environment. One saved from the environment's own
      // credentials must still belong to the same account (the .env may have changed).
      if (saved.source !== "ui" && this.env.email && saved.email !== this.env.email) return;
      this.session = { userId: saved.userId, userKey: saved.userKey };
      this.savedEmail = saved.email;
    } catch {
      // no saved session
    }
  }

  /** The Z-Library account of the saved session (never the password). */
  get accountEmail(): string | null {
    return this.savedEmail ?? this.env.email ?? null;
  }

  /** Signs in with the user's own credentials and keeps only the session key; the password is not stored. */
  async connect(email: string, password: string): Promise<void> {
    const previous = this.env;
    this.env = { ...previous, userId: undefined, userKey: undefined, email, password };
    this.session = null;
    this.loginSource = "ui";
    try {
      await this.login();
      this.savedEmail = email;
    } finally {
      this.loginSource = "env";
      this.env = { ...previous, userId: undefined, userKey: undefined, email: undefined, password: undefined };
    }
  }

  /** Forgets the saved session. */
  async disconnect(): Promise<void> {
    this.session = null;
    this.savedEmail = undefined;
    await rm(this.sessionFile, { force: true });
  }

  /** Switches the mirror (the session key stays: it belongs to the account, not to the domain). */
  setBaseUrl(baseUrl: string): void {
    this.env = { ...this.env, baseUrl: baseUrl.replace(/\/+$/, "") };
  }

  get baseUrl(): string {
    return this.env.baseUrl;
  }

  // ---- session

  private async getSession(): Promise<Session> {
    if (this.session) return this.session;
    await this.restore();
    if (this.session) return this.session;
    if (!this.configured) {
      throw new ZlibraryError(
        "not-configured",
        "Z-Library non è collegata: accedi con il tuo account Z-Library (oppure imposta ZLIBRARY_EMAIL e ZLIBRARY_PASSWORD in packages/library/.env).",
      );
    }
    try {
      const saved = JSON.parse(await readFile(this.sessionFile, "utf8")) as Partial<Session> & {
        email?: string;
      };
      if (saved.userId && saved.userKey && saved.email === this.env.email) {
        this.session = { userId: saved.userId, userKey: saved.userKey };
        return this.session;
      }
    } catch {
      // no saved session
    }
    this.loginInFlight ??= this.login().finally(() => {
      this.loginInFlight = null;
    });
    return this.loginInFlight;
  }

  /** rpc.php first (what the website uses), then the older /eapi/user/login: they have taken turns being broken. */
  private async login(): Promise<Session> {
    const { email = "", password = "", baseUrl } = this.env;
    const attempts: Array<{ path: string; body: Array<[string, string]> }> = [
      {
        path: "/rpc.php",
        body: [
          ["isModal", "true"],
          ["email", email],
          ["password", password],
          ["site_mode", "books"],
          ["action", "login"],
          ["gg_json_mode", "1"],
          ["redirectUrl", `${baseUrl}/`],
        ],
      },
      { path: "/eapi/user/login", body: [["email", email], ["password", password]] },
    ];
    let lastError = "accesso non riuscito";
    for (const attempt of attempts) {
      let data: Record<string, unknown>;
      try {
        data = await this.requestJson(attempt.path, {
          method: "POST",
          form: attempt.body,
          headers: { "X-Requested-With": "XMLHttpRequest", Origin: baseUrl, Referer: `${baseUrl}/` },
          authed: false,
        });
      } catch (error) {
        lastError = (error as Error).message;
        continue;
      }
      const container = (isRecord(data.response) ? data.response : isRecord(data.user) ? data.user : {}) as Record<
        string,
        unknown
      >;
      const userId = String(container.id ?? container.user_id ?? "");
      const userKey = String(container.remix_userkey ?? container.user_key ?? "");
      if (userId && userKey) {
        const session = { userId, userKey };
        this.session = session;
        await this.saveSession(session);
        return session;
      }
      lastError = String(container.message ?? errorMessageOf(data) ?? lastError);
      if (/too many|rate|wait/i.test(lastError)) break;
    }
    throw new ZlibraryError("auth", `Accesso a Z-Library non riuscito: ${lastError}`);
  }

  private async saveSession(session: Session): Promise<void> {
    try {
      await mkdir(path.dirname(this.sessionFile), { recursive: true });
      await writeFile(this.sessionFile, JSON.stringify({ ...session, email: this.env.email, source: this.loginSource }), { mode: 0o600 }); // never the password
      await chmod(this.sessionFile, 0o600);
    } catch {
      // best effort: the in-memory session still works
    }
  }

  private async dropSession(): Promise<void> {
    if (this.env.userId && this.env.userKey) return; // a session from the env cannot be refreshed
    this.session = null;
    await rm(this.sessionFile, { force: true });
  }

  // ---- HTTP

  private async requestJson(
    pathOrUrl: string,
    options: {
      method?: "GET" | "POST";
      form?: Array<[string, string]>;
      headers?: Record<string, string>;
      authed?: boolean;
    } = {},
  ): Promise<Record<string, unknown>> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${this.env.baseUrl}${pathOrUrl}`;
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: "application/json, text/javascript, */*; q=0.01",
      ...options.headers,
    };
    if (options.authed !== false) {
      const s = await this.getSession();
      headers.Cookie = `remix_userid=${s.userId}; remix_userkey=${s.userKey}`;
    }
    let body: string | undefined;
    if (options.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
      body = new URLSearchParams(options.form).toString();
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? "GET",
        headers,
        body,
        // a mirror redirect would turn a POST into a GET: follow nothing, report it
        redirect: "manual",
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new ZlibraryError("failed", `Z-Library non raggiungibile (${hostOf(url)}): ${(cause as Error).message}`, {
        cause,
      });
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") ?? "?";
      throw new ZlibraryError(
        "failed",
        `Il mirror ${hostOf(url)} reindirizza a ${location}: aggiorna ZLIBRARY_BASE_URL.`,
      );
    }
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      const challenge = /<html|captcha|cloudflare|challenge/i.test(text);
      throw new ZlibraryError(
        "failed",
        challenge
          ? `Il mirror ${hostOf(url)} risponde con una pagina di verifica anti-bot: prova un altro ZLIBRARY_BASE_URL.`
          : `Risposta non valida da Z-Library (HTTP ${response.status}).`,
      );
    }
    if (!isRecord(data)) throw new ZlibraryError("failed", "Risposta non valida da Z-Library.");
    if (response.status === 401 || response.status === 403) {
      throw new ZlibraryError("auth", errorMessageOf(data) ?? "Sessione Z-Library rifiutata.");
    }
    return data;
  }

  /** Authed call; a rejected session is dropped and the call retried once with a fresh sign-in. */
  private async authedJson(
    pathOrUrl: string,
    options: Parameters<ZlibraryClient["requestJson"]>[1] = {},
  ): Promise<Record<string, unknown>> {
    try {
      const data = await this.requestJson(pathOrUrl, options);
      if (looksLikeAuthError(data)) throw new ZlibraryError("auth", errorMessageOf(data) ?? "Sessione scaduta.");
      return data;
    } catch (error) {
      if (!(error instanceof ZlibraryError) || error.kind !== "auth" || !this.env.email) throw error;
      await this.dropSession();
      return this.requestJson(pathOrUrl, options);
    }
  }

  // ---- API

  async search(input: ZlibrarySearchRequest): Promise<ZlibrarySearchResponse> {
    const req = ZlibrarySearchRequestSchema.parse(input);
    const form: Array<[string, string]> = [
      ["message", req.query],
      ["page", String(req.page)],
      ["limit", String(PAGE_SIZE)],
      ["order", req.order],
    ];
    req.languages.forEach((lang, i) => form.push([`languages[${i}]`, lang]));
    req.extensions.forEach((ext, i) => form.push([`extensions[${i}]`, ext]));
    if (req.yearFrom !== undefined) form.push(["yearFrom", String(req.yearFrom)]);
    if (req.yearTo !== undefined) form.push(["yearTo", String(req.yearTo)]);

    const data = await this.authedJson("/eapi/book/search", { method: "POST", form });
    const apiError = errorMessageOf(data);
    if (data.success === 0 || (data.error && apiError)) {
      throw new ZlibraryError("failed", `Ricerca non riuscita: ${apiError ?? "errore sconosciuto"}`);
    }
    const raw = Array.isArray(data.books)
      ? data.books
      : isRecord(data.exactMatch) && Array.isArray(data.exactMatch.books)
        ? data.exactMatch.books
        : [];
    const all = raw.filter(isRecord).map(toBook).filter((b): b is ZlibraryBook => b !== null);

    // The API's year bounds are not always honoured, and it has no size bound at all.
    const maxBytes = req.maxSizeMb === undefined ? undefined : req.maxSizeMb * 1024 * 1024;
    const books = all.filter((b) => {
      if (maxBytes !== undefined && b.size !== null && b.size > maxBytes) return false;
      if (req.yearFrom !== undefined && b.year !== null && b.year < req.yearFrom) return false;
      if (req.yearTo !== undefined && b.year !== null && b.year > req.yearTo) return false;
      return true;
    });

    const pagination = isRecord(data.pagination) ? data.pagination : {};
    const totalItems = toNumber(pagination.total_items) ?? toNumber(data.exactBooksCount);
    const totalPages =
      toNumber(pagination.total_pages) ?? (totalItems !== null ? Math.ceil(totalItems / PAGE_SIZE) : null);
    return { books, page: req.page, totalPages, totalItems, filteredOut: all.length - books.length };
  }

  async quota(): Promise<{ today: number; limit: number }> {
    const data = await this.authedJson("/eapi/user/profile");
    const user = isRecord(data.user) ? data.user : null;
    const today = toNumber(user?.downloads_today);
    const limit = toNumber(user?.downloads_limit);
    if (data.success !== 1 || today === null || limit === null) {
      throw new ZlibraryError("failed", errorMessageOf(data) ?? "Quota download non disponibile.");
    }
    return { today, limit };
  }

  /** Download link + the book file. Throws `limit` when the daily quota is used up. */
  async download(
    id: string,
    hash: string,
    maxBytes: number,
    /** Refuse other formats before the file is fetched (the fetch is what spends the daily quota). */
    onlyExtension?: string,
  ): Promise<DownloadedFile> {
    if (!/^\d+$/.test(id) || !/^[\w-]+$/.test(hash)) {
      throw new ZlibraryError("failed", "Identificativo del libro non valido.");
    }
    const data = await this.authedJson(`/eapi/book/${id}/${hash}/file`);
    const file = isRecord(data.file) ? data.file : null;
    if (data.success !== 1 || !file) {
      throw new ZlibraryError("failed", errorMessageOf(data) ?? "Link di download non disponibile.");
    }
    const link = typeof file.downloadLink === "string" ? file.downloadLink : null;
    if (!link) {
      if (file.allowDownload === false) {
        throw new ZlibraryError("limit", "Limite giornaliero di download di Z-Library raggiunto. Riprova più tardi.");
      }
      throw new ZlibraryError("failed", "Z-Library non ha fornito un link di download.");
    }
    const extension = String(file.extension ?? "epub").toLowerCase();
    if (onlyExtension && extension !== onlyExtension.toLowerCase()) {
      throw new ZlibraryError(
        "wrong-format",
        `Solo gli ${onlyExtension.toUpperCase()} sono supportati: questo libro è ${extension.toUpperCase()}.`,
      );
    }
    const displayName = await this.displayNameFor(id, hash, file);

    const session = await this.getSession();
    let response: Response;
    try {
      response = await fetch(new URL(link, this.env.baseUrl), {
        headers: {
          "User-Agent": USER_AGENT,
          Cookie: `remix_userid=${session.userId}; remix_userkey=${session.userKey}`,
          Referer: `${this.env.baseUrl}/`,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new ZlibraryError("failed", `Download non riuscito: ${(cause as Error).message}`, { cause });
    }
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (type.includes("text/html")) {
      await response.body?.cancel();
      throw new ZlibraryError("limit", "Z-Library ha risposto con una pagina HTML: probabilmente il limite di download è raggiunto.");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ZlibraryError("failed", `Download non riuscito (HTTP ${response.status}).`);
    }
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maxBytes) {
      await response.body?.cancel();
      throw new ZlibraryError("failed", `Il file supera il limite di ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) throw new ZlibraryError("failed", "Z-Library ha inviato un file vuoto.");
    if (bytes.length > maxBytes) {
      throw new ZlibraryError("failed", `Il file supera il limite di ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    }
    return { bytes, extension, displayName };
  }

  /**
   * "Author - Title" from the book record. The file record's `description` is the uploaded file name, often with the
   * mirrors appended ("… (z-library.sk, 1lib.sk, z-lib.sk)"), so it is only the fallback, cleaned up.
   */
  private async displayNameFor(id: string, hash: string, file: Record<string, unknown>): Promise<string> {
    try {
      const data = await this.authedJson(`/eapi/book/${id}/${hash}`);
      const book = isRecord(data.book) ? toBook(data.book) : null;
      if (book && book.title !== "Senza titolo") {
        return book.author !== "Autore sconosciuto" ? `${book.author} - ${book.title}` : book.title;
      }
    } catch {
      // fall back to the file record
    }
    const cleaned = (str(file.description) ?? "")
      .replace(/\s*\([^)]*(?:z-lib|1lib|zlibrary|z-library)[^)]*\)\s*/gi, " ")
      .replace(/[_\s]+$/, "")
      .trim();
    return cleaned || `zlibrary-${id}`;
  }
}

// ---- helpers

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function errorMessageOf(data: Record<string, unknown>): string | null {
  const e = data.error;
  if (typeof e === "string") return e;
  if (isRecord(e) && typeof e.message === "string") return e.message;
  const errors = data.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0];
    if (typeof first === "string") return first;
    if (isRecord(first) && typeof first.message === "string") return first.message;
  }
  return typeof data.message === "string" ? data.message : null;
}

function looksLikeAuthError(data: Record<string, unknown>): boolean {
  const message = errorMessageOf(data);
  return data.success === 0 && message !== null && /auth|login|session|logged/i.test(message);
}

/** A cover URL is only kept when it is absolute http(s) (the API sometimes sends placeholders or relative paths). */
function usableCover(v: unknown): string | null {
  const s = str(v);
  if (!s || !/^https?:\/\//i.test(s)) return null;
  return s;
}

function toBook(raw: Record<string, unknown>): ZlibraryBook | null {
  const id = str(raw.id);
  const hash = str(raw.hash);
  if (!id || !hash) return null;
  const year = toNumber(raw.year);
  return {
    id,
    hash,
    title: str(raw.title) ?? "Senza titolo",
    author: str(raw.author) ?? "Autore sconosciuto",
    year: year && year > 0 ? year : null,
    extension: (str(raw.extension) ?? "?").toUpperCase(),
    size: toNumber(raw.filesize),
    sizeLabel: str(raw.filesizeString),
    language: str(raw.language),
    publisher: str(raw.publisher),
    cover: usableCover(raw.cover),
    description: str(raw.description),
    pages: toNumber(raw.pages) || null,
    isbn: str(raw.identifier),
  };
}

/** A file-system-safe "Author - Title" (Kobo/FAT32: no / \ : * ? " < > |), at most 120 characters. */
export function safeFileStem(name: string): string {
  const cleaned = name
    .replace(/[/\\:*?"<>|\p{Cc}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  return cleaned || "libro";
}
