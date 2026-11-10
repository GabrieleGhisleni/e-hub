import { z } from "zod";

/** One Drive path segment: no FAT32-forbidden characters, no slashes, not "." or "..". */
const PathSegmentSchema = z
  .string()
  .min(1)
  .regex(/^[^/\\:*?"<>|\p{Cc}]+$/u, 'must be a single folder name without / \\ : * ? " < > |')
  .refine(
    (s) => s.trim() === s && s !== "." && s !== "..",
    "no leading/trailing spaces, not . or ..",
  );

/** Path inside the rclone remote: "" (remote root) or segments joined by "/", no leading/trailing slash. */
const RemoteRootSchema = z
  .string()
  .refine(
    (s) => s === "" || s.split("/").every((seg) => PathSegmentSchema.safeParse(seg).success),
    'must be "" or a relative path like "Libri" or "Libri-test/e-library" (no leading or trailing "/")',
  );

/** An origin such as `http://127.0.0.1:5173` (scheme + host + optional port, nothing else). */
const OriginSchema = z
  .string()
  .regex(/^https?:\/\/[^/\s?#]+$/, "must be an origin like http://127.0.0.1:5173 (no path)");

export const DriveConfigSchema = z.object({
  /** rclone remote name without the colon. The real one is `elib` (root_folder_id = Drive `Libri/`). */
  remote: z.string().regex(/^[\w][\w.+@ -]*$/, "must be an rclone remote name (no colon)"),
  /** Folder inside the remote that holds the two trees; "" = the remote root. */
  root: RemoteRootSchema,
  /** KEPUB tree, the folder the Kobo syncs. */
  koboTree: PathSegmentSchema,
  /** Original EPUB tree. */
  archiveTree: PathSegmentSchema,
  /** Whether each tree has a `<topic label>/` subfolder level. */
  topicSubfolders: z.object({ kobo: z.boolean(), archive: z.boolean() }),
});
export type DriveConfig = z.infer<typeof DriveConfigSchema>;

/** Shape of `elib.config.json` (versioned, no secrets: the rclone token stays in rclone.conf). */
export const ElibConfigSchema = z.object({
  drive: DriveConfigSchema,
  cache: z.object({
    /** Local cache outside the repo; `~` is expanded by the Node loader. */
    dir: z.string().min(1),
  }),
  server: z.object({
    /** Local Hono server, always bound to 127.0.0.1. */
    port: z.number().int().min(1).max(65535),
    /** UI origins allowed to call the local API (Origin header check). */
    allowedOrigins: z.array(OriginSchema).min(1),
  }),
  site: z.object({
    /** Base path of the public site and of the router, with leading and trailing slash. */
    basePath: z
      .string()
      .regex(/^\/(?:[^/\s]+\/)*$/, 'must start and end with "/", e.g. "/e-library/"'),
  }),
});
export type ElibConfig = z.infer<typeof ElibConfigSchema>;
