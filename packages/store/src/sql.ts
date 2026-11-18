/** Splits a migration file into statements: strips `--` comment lines, cuts on `;` at the end of a line. */
export function splitStatements(sql: string): string[] {
  const cleaned = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return cleaned
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The libSQL client as the migration runner needs it (`@libsql/client` implements both methods). */
export interface MigrationClient {
  execute(statement: string | { sql: string; args: (string | number | null)[] }): Promise<{ rows: unknown[] }>;
  /** All statements in one transaction. */
  batch(statements: string[], mode?: "write"): Promise<unknown>;
}

export interface MigrationFile {
  name: string;
  sql: string;
}

/**
 * Applies the files not yet recorded in `schema_migrations`, each in one transaction, in name order. 0001 is idempotent
 * (so a database that had it applied before the table existed is fine); 0002 and later are applied exactly once.
 * Returns the names applied.
 */
export async function applyMigrations(db: MigrationClient, files: MigrationFile[]): Promise<string[]> {
  await db.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = new Set(
    ((await db.execute("SELECT name FROM schema_migrations")).rows as { name: unknown }[]).map((r) => String(r.name)),
  );
  const applied: string[] = [];
  for (const file of [...files].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (done.has(file.name)) continue;
    const record = `INSERT INTO schema_migrations (name, applied_at) VALUES ('${file.name.replace(/'/g, "''")}', '${new Date().toISOString()}')`;
    await db.batch([...splitStatements(file.sql), record], "write");
    applied.push(file.name);
  }
  return applied;
}
