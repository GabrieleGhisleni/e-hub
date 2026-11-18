/**
 * Document tables: `id text primary key, data jsonb, updated_at timestamptz` (supabase/migrations).
 * `SupabaseDocClient` speaks PostgREST with the service key; `MemoryDocClient` is the same thing for tests.
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

export interface SupabaseOptions {
  /** Project URL, e.g. `https://xyz.supabase.co`. */
  url: string;
  serviceRoleKey: string;
  fetch?: typeof fetch;
}

interface Row {
  id: string;
  data: unknown;
  updated_at: string;
}

const PAGE = 1000;

export class SupabaseDocClient implements DocClient {
  private readonly base: string;
  private readonly key: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: SupabaseOptions) {
    this.base = `${options.url.replace(/\/+$/, "")}/rest/v1`;
    this.key = options.serviceRoleKey;
    this.fetchFn = options.fetch ?? fetch;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.fetchFn(url, {
      ...init,
      headers: {
        apikey: this.key,
        authorization: `Bearer ${this.key}`,
        "content-type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!response.ok) {
      // The body of a PostgREST error is safe to show (no secrets); the URL carries only table and id.
      const detail = await response.text().catch(() => "");
      throw new Error(`Supabase ${init.method ?? "GET"} ${response.status}: ${detail.slice(0, 300)}`);
    }
    return response;
  }

  private static toDoc(row: Row): Doc {
    return { id: row.id, data: row.data, updatedAt: row.updated_at };
  }

  async get(table: string, id: string): Promise<Doc | null> {
    const url = `${this.base}/${assertTable(table)}?id=eq.${encodeURIComponent(id)}&select=id,data,updated_at`;
    const rows = (await (await this.request(url)).json()) as Row[];
    return rows[0] ? SupabaseDocClient.toDoc(rows[0]) : null;
  }

  async list(table: string): Promise<Doc[]> {
    const docs: Doc[] = [];
    for (let from = 0; ; from += PAGE) {
      const url = `${this.base}/${assertTable(table)}?select=id,data,updated_at&order=id.asc`;
      const response = await this.request(url, {
        headers: { range: `${from}-${from + PAGE - 1}`, "range-unit": "items" },
      });
      const rows = (await response.json()) as Row[];
      docs.push(...rows.map(SupabaseDocClient.toDoc));
      if (rows.length < PAGE) return docs;
    }
  }

  async put(table: string, id: string, data: unknown): Promise<void> {
    const url = `${this.base}/${assertTable(table)}?on_conflict=id`;
    await this.request(url, {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id, data, updated_at: new Date().toISOString() }),
    });
  }

  async delete(table: string, id: string): Promise<void> {
    await this.request(`${this.base}/${assertTable(table)}?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { prefer: "return=minimal" },
    });
  }
}
