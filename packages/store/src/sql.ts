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
