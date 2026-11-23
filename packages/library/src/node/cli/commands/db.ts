/**
 * `elib db status|sync`: compares the local library (data/ + EPUB cache) with the account on the hosted API and fills
 * the gaps in both directions. Needs EHUB_API_URL and EHUB_API_TOKEN (the token is copied from Impostazioni).
 */
import { RemoteBackend } from "@ehub/store";
import { applyDiff, diffLibrary, type DbDiff, type Side } from "../../dbsync/index.ts";
import { loadLocalEnv } from "../../summary/llm.ts";
import type { CliCommand, CliContext } from "../program.ts";

function remoteOf(ctx: CliContext): RemoteBackend | null {
  if (ctx.io.env === process.env) loadLocalEnv();
  const { EHUB_API_URL: apiUrl, EHUB_API_TOKEN: token } = ctx.io.env;
  if (!apiUrl || !token) {
    ctx.err("error: servono EHUB_API_URL e EHUB_API_TOKEN (il token si copia da Impostazioni dopo il login), anche in .env.local.");
    ctx.fail(1);
    return null;
  }
  return new RemoteBackend("library", { apiUrl, token, ...(ctx.io.fetch ? { fetch: ctx.io.fetch } : {}) });
}

function report(ctx: CliContext, diff: DbDiff): void {
  if (diff.books.length === 0 && diff.topicsOnlyLocal.length === 0 && diff.topicsOnlyRemote.length === 0) {
    ctx.out("Locale e account sono allineati.");
    return;
  }
  for (const book of diff.books) {
    const where = !book.remote ? "solo in locale" : !book.local ? "solo sull'account" : "diverso";
    ctx.out(`${book.id}  ${book.title || "(senza titolo)"}  [${where}]`);
    if (book.onlyLocal.length) ctx.out(`    solo locale:   ${book.onlyLocal.join(", ")}`);
    if (book.onlyRemote.length) ctx.out(`    solo account:  ${book.onlyRemote.join(", ")}`);
    if (book.differing.length) ctx.out(`    differiscono:  ${book.differing.join(", ")}`);
  }
  if (diff.topicsOnlyLocal.length) ctx.out(`Argomenti solo in locale: ${diff.topicsOnlyLocal.join(", ")}`);
  if (diff.topicsOnlyRemote.length) ctx.out(`Argomenti solo sull'account: ${diff.topicsOnlyRemote.join(", ")}`);
}

export const dbCommand: CliCommand = {
  register(program, ctx) {
    const db = program.command("db").description("Confronta e allinea la libreria locale con quella dell'account hosted");

    db.command("status")
      .description("Mostra cosa c'è solo in locale, solo sull'account o in versioni diverse")
      .option("--epubs", "confronta anche gli EPUB (scarica quelli dell'account: lento)")
      .action(async (options: { epubs?: boolean }) => {
        const remote = remoteOf(ctx);
        if (!remote) return;
        const { dataDir, cache } = ctx.config();
        report(ctx, await diffLibrary({ dataDir, cacheDir: cache.dir, remote, epubs: options.epubs === true }));
      });

    db.command("sync")
      .description("Copia ciò che manca da una parte all'altra (senza --apply mostra solo il piano)")
      .option("--apply", "esegue davvero")
      .option("--prefer <lato>", "per i file diversi vince 'local' o 'remote' (altrimenti restano com'è)")
      .option("--epubs", "confronta anche gli EPUB (scarica quelli dell'account: lento)")
      .action(async (options: { apply?: boolean; prefer?: string; epubs?: boolean }) => {
        const remote = remoteOf(ctx);
        if (!remote) return;
        if (options.prefer && options.prefer !== "local" && options.prefer !== "remote") {
          ctx.err("error: --prefer vale 'local' o 'remote'.");
          ctx.fail(1);
          return;
        }
        const { dataDir, cache } = ctx.config();
        const base = { dataDir, cacheDir: cache.dir, remote, epubs: options.epubs === true };
        const diff = await diffLibrary(base);
        report(ctx, diff);
        if (!options.apply) {
          ctx.out("\nSolo anteprima: aggiungi --apply per eseguire.");
          return;
        }
        const result = await applyDiff(diff, { ...base, ...(options.prefer ? { prefer: options.prefer as Side } : {}) });
        ctx.out(`\nCaricati ${result.pushed.length}, scaricati ${result.pulled.length}, lasciati ${result.skipped.length} (diversi, serve --prefer).`);
        for (const failure of result.failed) ctx.err(`errore ${failure.key}: ${failure.message}`);
        if (result.failed.length > 0) ctx.fail(1);
      });
  },
};
