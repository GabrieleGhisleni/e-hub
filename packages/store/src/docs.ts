/**
 * Document tables: `id`, `data` (JSON), `updated_at` (turso/migrations).
 * `TursoDocClient` talks to Turso (libSQL); `MemoryDocClient` is the same thing for tests.
 */
export interface Doc {
  id: string;
  data: unknown;
  updatedAt: string;
}

export interface DocClient {
  get(table: string, id: string): Promise<Doc | null>;
  list(table: string): Promise<Doc[]>;
  /** Insert or replace; `updatedAt` is set by the store. */
  put(table: string, id: string, data: unknown): Promise<void>;
  delete(table: string, id: string): Promise<void>;
}

const TABLE = /^[a-z][a-z0-9_]*$/;

export function assertTable(table: string): string {
  if (!TABLE.test(table)) throw new Error(`invalid table name: ${table}`);
  return table;
}

export class MemoryDocClient implements DocClient {
  readonly tables = new Map<string, Map<string, Doc>>();

  private table(name: string): Map<string, Doc> {
    assertTable(name);
    let t = this.tables.get(name);
    if (!t) this.tables.set(name, (t = new Map()));
    return t;
  }
  async get(table: string, id: string): Promise<Doc | null> {
    return this.table(table).get(id) ?? null;
  }
  async list(table: string): Promise<Doc[]> {
    return [...this.table(table).values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  async put(table: string, id: string, data: unknown): Promise<void> {
    // A JSON round trip, as the database does: what comes back is what was stored, not the caller's object.
    this.table(table).set(id, {
      id,
      data: JSON.parse(JSON.stringify(data)),
      updatedAt: new Date().toISOString(),
    });
  }
  async delete(table: string, id: string): Promise<void> {
    this.table(table).delete(id);
  }
}

/**
 * The one method of a libSQL client we use (`@libsql/client` implements it; tests pass `node:sqlite` behind it).
 * Rows come back as objects keyed by column name.
 */
export interface SqlClient {
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

/** Documents in Turso (libSQL): `<table>(id TEXT PRIMARY KEY, data TEXT json, updated_at TEXT)`, see turso/migrations. */
export class TursoDocClient implements DocClient {
  private readonly db: SqlClient;

  // Plain field, no parameter property: this file may be loaded by Node's type stripping.
  constructor(db: SqlClient) {
    this.db = db;
  }

  private async rows(sql: string, args: (string | number | null)[] = []): Promise<Row[]> {
    return (await this.db.execute({ sql, args })).rows as Row[];
  }

  async get(table: string, id: string): Promise<Doc | null> {
    const rows = await this.rows(`SELECT id, data, updated_at FROM ${assertTable(table)} WHERE id = ?`, [id]);
    return rows[0] ? toDoc(rows[0]) : null;
  }

  async list(table: string): Promise<Doc[]> {
    return (await this.rows(`SELECT id, data, updated_at FROM ${assertTable(table)} ORDER BY id`)).map(toDoc);
  }

  async put(table: string, id: string, data: unknown): Promise<void> {
    await this.rows(
      `INSERT INTO ${assertTable(table)} (id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      [id, JSON.stringify(data), new Date().toISOString()],
    );
  }

  async delete(table: string, id: string): Promise<void> {
    await this.rows(`DELETE FROM ${assertTable(table)} WHERE id = ?`, [id]);
  }
}
