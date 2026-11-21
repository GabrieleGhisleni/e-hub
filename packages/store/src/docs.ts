import { assertUserId } from "./user-context.ts";

/**
 * Document tables: `user_id`, `id`, `data` (JSON), `updated_at`, primary key `(user_id, id)` (turso/migrations).
 * There is no way to read or write a row without naming its owner: `DocClient.forUser(userId)` returns the only handle
 * to the data, and every query of it carries the `user_id`. `TursoDocClient` talks to Turso (libSQL);
 * `MemoryDocClient` is the same thing for tests.
 */
export interface Doc {
  id: string;
  data: unknown;
  updatedAt: string;
}

/** One user's documents. */
export type DocChange = { table: string; id: string; data?: unknown };

export interface UserDocs {
  get(table: string, id: string): Promise<Doc | null>;
  list(table: string): Promise<Doc[]>;
  /** Insert or replace; `updatedAt` is set by the store. */
  put(table: string, id: string, data: unknown): Promise<void>;
  delete(table: string, id: string): Promise<void>;
  batch(changes: DocChange[]): Promise<void>;
}

export interface UserRecord {
  /** Google `sub`; `email:<address>` for an owner prepared by the migration who has not logged in yet. */
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface UserStore {
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  /** Every user (for maintenance jobs that run outside a request). */
  list(): Promise<UserRecord[]>;
  /** Creates the user, or updates email and name of an existing one. */
  upsert(user: { id: string; email: string; name: string }): Promise<UserRecord>;
  /** Moves a placeholder user and all their rows to `toId`. */
  reassign(fromId: string, toId: string): Promise<void>;
}

export interface DocClient {
  forUser(userId: string): UserDocs;
  readonly users: UserStore;
}

/** Every table that holds user data (the `users` table is separate). Keep in sync with turso/migrations. */
export const DATA_TABLES = [
  "books",
  "book_summaries",
  "book_highlights",
  "book_markdown",
  "topics",
  "shows",
  "episodes",
  "podcast_transcripts",
  "conversations",
  "notes",
  "explorations",
  "chats",
  "kobo_queue",
] as const;

const TABLE = /^[a-z][a-z0-9_]*$/;

export function assertTable(table: string): string {
  if (!TABLE.test(table)) throw new Error(`invalid table name: ${table}`);
  return table;
}

export class MemoryDocClient implements DocClient {
  /** table -> userId -> id -> doc */
  readonly tables = new Map<string, Map<string, Map<string, Doc>>>();
  readonly userRows = new Map<string, UserRecord>();
  readonly users: UserStore = {
    findById: async (id) => this.userRows.get(id) ?? null,
    findByEmail: async (email) => [...this.userRows.values()].find((u) => u.email === email) ?? null,
    list: async () => [...this.userRows.values()],
    upsert: async ({ id, email, name }) => {
      const record = { id, email, name, createdAt: this.userRows.get(id)?.createdAt ?? new Date().toISOString() };
      this.userRows.set(id, record);
      return record;
    },
    reassign: async (fromId, toId) => {
      const user = this.userRows.get(fromId);
      if (user) {
        this.userRows.delete(fromId);
        this.userRows.set(toId, { ...user, id: toId });
      }
      for (const byUser of this.tables.values()) {
        const rows = byUser.get(fromId);
        if (!rows) continue;
        byUser.delete(fromId);
        byUser.set(toId, rows);
      }
    },
  };

  private rows(table: string, userId: string): Map<string, Doc> {
    assertTable(table);
    let byUser = this.tables.get(table);
    if (!byUser) this.tables.set(table, (byUser = new Map()));
    let rows = byUser.get(userId);
    if (!rows) byUser.set(userId, (rows = new Map()));
    return rows;
  }

  forUser(userId: string): UserDocs {
    assertUserId(userId);
    return {
      get: async (table, id) => this.rows(table, userId).get(id) ?? null,
      list: async (table) =>
        [...this.rows(table, userId).values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      put: async (table, id, data) => {
        // A JSON round trip, as the database does: what comes back is what was stored, not the caller's object.
        this.rows(table, userId).set(id, {
          id,
          data: JSON.parse(JSON.stringify(data)),
          updatedAt: new Date().toISOString(),
        });
      },
      batch: async (changes) => {
        const prepared = changes.map(({ table, id, data }) => ({
          rows: this.rows(table, userId), id,
          doc: data === undefined ? undefined : { id, data: JSON.parse(JSON.stringify(data)), updatedAt: new Date().toISOString() },
        }));
        for (const { rows, id, doc } of prepared) {
          if (doc) rows.set(id, doc);
          else rows.delete(id);
        }
      },
      delete: async (table, id) => {
        this.rows(table, userId).delete(id);
      },
    };
  }
}

/**
 * The one method of a libSQL client we use (`@libsql/client` implements it; tests pass `node:sqlite` behind it).
 * Rows come back as objects keyed by column name.
 */
type Statement = { sql: string; args: (string | number | null)[] };

export interface SqlClient {
  batch?(statements: Statement[], mode: "write"): Promise<unknown>;
  execute(statement: { sql: string; args: (string | number | null)[] }): Promise<{
    rows: ArrayLike<Record<string, unknown>>[] | Record<string, unknown>[];
  }>;
}

type Row = Record<string, unknown>;

function toDoc(row: Row): Doc {
  return {
    id: String(row.id),
    data: JSON.parse(String(row.data)) as unknown,
    updatedAt: String(row.updated_at),
  };
}

/** Documents in Turso (libSQL): `<table>(user_id, id, data TEXT json, updated_at, PRIMARY KEY (user_id, id))`. */
export class TursoDocClient implements DocClient {
  private readonly db: SqlClient;
  readonly users: UserStore;

  // Plain field, no parameter property: this file may be loaded by Node's type stripping.
  constructor(db: SqlClient) {
    this.db = db;
    this.users = new TursoUserStore(db);
  }

  forUser(userId: string): UserDocs {
    assertUserId(userId);
    const db = this.db;
    const rows = async (sql: string, args: (string | number | null)[]): Promise<Row[]> =>
      (await db.execute({ sql, args })).rows as Row[];
    return {
      async get(table, id) {
        const found = await rows(
          `SELECT id, data, updated_at FROM ${assertTable(table)} WHERE user_id = ? AND id = ?`,
          [userId, id],
        );
        return found[0] ? toDoc(found[0]) : null;
      },
      async list(table) {
        const found = await rows(
          `SELECT id, data, updated_at FROM ${assertTable(table)} WHERE user_id = ? ORDER BY id`,
          [userId],
        );
        return found.map(toDoc);
      },
      async put(table, id, data) {
        await rows(
          `INSERT INTO ${assertTable(table)} (user_id, id, data, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
          [userId, id, JSON.stringify(data), new Date().toISOString()],
        );
      },
      async batch(changes) {
        if (!db.batch) throw new Error("Database transactions unavailable");
        await db.batch(changes.map(({ table, id, data }): Statement => data === undefined
          ? { sql: `DELETE FROM ${assertTable(table)} WHERE user_id = ? AND id = ?`, args: [userId, id] }
          : {
            sql: `INSERT INTO ${assertTable(table)} (user_id, id, data, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
            args: [userId, id, JSON.stringify(data), new Date().toISOString()],
          }), "write");
      },
      async delete(table, id) {
        await rows(`DELETE FROM ${assertTable(table)} WHERE user_id = ? AND id = ?`, [userId, id]);
      },
    };
  }
}

function toUser(row: Row): UserRecord {
  return { id: String(row.id), email: String(row.email), name: String(row.name), createdAt: String(row.created_at) };
}

class TursoUserStore implements UserStore {
  private readonly db: SqlClient;
  constructor(db: SqlClient) {
    this.db = db;
  }
  private async rows(sql: string, args: (string | number | null)[]): Promise<Row[]> {
    return (await this.db.execute({ sql, args })).rows as Row[];
  }
  async findById(id: string): Promise<UserRecord | null> {
    const found = await this.rows("SELECT id, email, name, created_at FROM users WHERE id = ?", [id]);
    return found[0] ? toUser(found[0]) : null;
  }
  async findByEmail(email: string): Promise<UserRecord | null> {
    const found = await this.rows("SELECT id, email, name, created_at FROM users WHERE email = ?", [email]);
    return found[0] ? toUser(found[0]) : null;
  }
  async list(): Promise<UserRecord[]> {
    return (await this.rows("SELECT id, email, name, created_at FROM users ORDER BY created_at", [])).map(toUser);
  }
  async upsert(user: { id: string; email: string; name: string }): Promise<UserRecord> {
    await this.rows(
      `INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name`,
      [user.id, user.email, user.name, new Date().toISOString()],
    );
    return (await this.findById(user.id))!;
  }
  async reassign(fromId: string, toId: string): Promise<void> {
    assertUserId(toId);
    // Idempotent and resumable: rows still under `fromId` move on the next call. The user row goes last.
    for (const table of DATA_TABLES) {
      await this.rows(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`, [toId, fromId]);
    }
    await this.rows("UPDATE users SET id = ? WHERE id = ?", [toId, fromId]);
  }
}
