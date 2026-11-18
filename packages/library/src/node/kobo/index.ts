/**
 * The Kobo e-reader, reached over SSH (docs/kobo-ssh-migration.md): the flat `booksDir` holds one KEPUB and one KOReader
 * sidecar folder per book. `createKoboContext` builds what the operations need; `reconcile` / `removeBookFiles` make
 * the Kobo mirror the repo; the transports (`sshTransport`, `localTransport`) do the file operations.
 */
export * from "./context.ts";
export * from "./duplicates.ts";
export * from "./highlights.ts";
export * from "./local.ts";
export * from "./queue.ts";
export * from "./discovery.ts";
export * from "./prune-guard.ts";
export * from "./sidecar.ts";
export * from "./ssh.ts";
export * from "./sync.ts";
export * from "./transport.ts";
