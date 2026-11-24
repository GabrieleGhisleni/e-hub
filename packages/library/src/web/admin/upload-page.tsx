import {
  AlertTriangleIcon,
  CircleXIcon,
  FileUpIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { UploadResponseSchema, type UploadResponse } from "@shared/api";
import { UNSORTED_TOPIC_ID } from "@shared/labels";
import { BookCover } from "@library/components/book-cover";
import { Button } from "@ehub/ui/components/button";
import { cn } from "@library/lib/utils";
import { adminApi, uploadCoverUrl } from "./api";
import { AdminPage } from "./admin-page";
import { BookFormFields } from "./book-form-fields";
import { CoverPicker, type CoverOption } from "./cover-picker";
import {
  formStateFromMetadata,
  toNewBook,
  validateForm,
  type BookFormState,
} from "./lib/book-form";
import { defaultCoverChoice, openLibraryIdFor } from "./lib/covers";
import { ApiRequestError, friendlyMessage } from "./lib/errors";
import { announceWrite } from "./notify";
import { showReport } from "./report-store";
import { useAdminIndexData } from "./use-admin-data";
import { libraryPath } from "@library/lib/paths";

const MIB = 1024 * 1024;
// Leave room for the multipart envelope under Cloudflare's hosted request limit.
const EPUB_MAX_BYTES = 99 * MIB;
const EPUB_MAX_MIB = EPUB_MAX_BYTES / MIB;

type Stage =
  | { kind: "pick"; error?: string }
  | { kind: "analyzing"; fileName: string }
  | { kind: "form"; upload: UploadResponse };

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

function Dropzone({ onFile, error }: { onFile: (file: File) => void; error?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors",
          over ? "border-brand bg-brand-soft/60" : "border-border bg-card",
        )}
      >
        <FileUpIcon aria-hidden className="size-9 text-brand" />
        <p className="font-serif text-xl">Trascina qui un file EPUB</p>
        <p className="text-sm text-muted-foreground">
          oppure scegline uno dal computer (fino a {EPUB_MAX_MIB} MiB)
        </p>
        <Button onClick={() => input.current?.click()}>Scegli un file…</Button>
        <input
          ref={input}
          type="file"
          accept=".epub,application/epub+zip"
          className="sr-only"
          aria-label="File EPUB"
          data-testid="epub-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onFile(file);
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-destructive">
          <CircleXIcon className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "strong" | "soft" | "info";
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "strong" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm",
        tone === "strong" && "border-destructive/50 bg-destructive/10",
        tone === "soft" && "border-amber-500/50 bg-amber-500/10",
        tone === "info" && "border-border bg-muted/50 text-muted-foreground",
      )}
    >
      <AlertTriangleIcon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "strong" && "text-destructive",
          tone === "soft" && "text-amber-600 dark:text-amber-400",
        )}
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function UploadForm({ upload, onCancel }: { upload: UploadResponse; onCancel: () => void }) {
  const navigate = useNavigate();
  const { topics, allTags } = useAdminIndexData();
  const initial = useMemo(
    () =>
      formStateFromMetadata(upload.metadata, {
        title: upload.fileName.replace(/\.epub$/i, ""),
        topic: UNSORTED_TOPIC_ID,
      }),
    [upload],
  );
  const [state, setState] = useState<BookFormState>(initial);
  const [cover, setCover] = useState<string>(() => defaultCoverChoice(upload.covers));
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiRequestError | Error | null>(null);

  const errors = validateForm(state);
  const valid = Object.keys(errors).length === 0;

  const epub = upload.covers.find((c) => c.source === "epub");
  const ol = upload.covers.find((c) => c.source === "openlibrary");
  const options: CoverOption[] = [];
  if (epub) {
    options.push({
      key: "epub",
      label: "Dall’EPUB",
      src: uploadCoverUrl(upload.uploadId, "epub"),
      caption: epub.width && epub.height ? `${epub.width}×${epub.height}` : "La tua edizione",
    });
  }
  if (ol) {
    options.push({
      key: "openlibrary",
      label: "Open Library",
      src: uploadCoverUrl(upload.uploadId, "openlibrary"),
      badge: ol.needsConfirmation ? "da confermare" : undefined,
      caption: ol.needsConfirmation ? (
        <>
          Trovata per titolo e autore
          {ol.title ? (
            <>
              : <em>{ol.title}</em>
              {ol.authors?.length ? ` di ${ol.authors.join(", ")}` : ""}
            </>
          ) : null}
          . Spesso è un’altra edizione.
        </>
      ) : (
        "Trovata tramite ISBN"
      ),
    });
  }
  options.push({
    key: "placeholder",
    label: "Segnaposto",
    caption: "Generato da titolo e autore",
    fallback: (
      <BookCover
        book={{
          id: upload.uploadId,
          title: state.title || "Senza titolo",
          authors: state.authors,
          coverUrl: null,
        }}
        className="size-full shadow-none"
      />
    ),
  });

  const submit = useCallback(async () => {
    setShowErrors(true);
    if (!valid || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const source = cover as "epub" | "openlibrary" | "placeholder";
      const response = await adminApi.createBook({
        uploadId: upload.uploadId,
        book: toNewBook(state, upload.metadata.subjects),
        cover: source,
        openLibraryCoverId: openLibraryIdFor(source, upload.covers),
      });
      announceWrite(`Aggiunto «${response.book.title}»`, response.report);
      void navigate(libraryPath(`book/${response.book.id}`));
    } catch (error) {
      setFailure(error instanceof Error ? error : new Error(String(error)));
      if (error instanceof ApiRequestError && error.report) {
        showReport({ title: "Il libro non è stato aggiunto", report: error.report });
      }
      setBusy(false);
    }
  }, [valid, busy, cover, upload, state, navigate]);

  /** Cancel: the staging area is discarded (it would also expire after 24h). */
  const cancel = useCallback(() => {
    void adminApi.discardUpload(upload.uploadId).catch(() => {});
    onCancel();
  }, [upload.uploadId, onCancel]);

  const expired = failure instanceof ApiRequestError && failure.code === "upload-not-found";
  const md5 = upload.duplicates.filter((d) => d.kind === "md5");
  const soft = upload.duplicates.filter((d) => d.kind === "title-author");

  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      aria-busy={busy}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg bg-muted/50 px-3 py-2 text-sm">
        <span className="min-w-0 font-medium break-all">{upload.fileName}</span>
        <span className="text-muted-foreground tabular-nums">{formatSize(upload.size)}</span>
      </div>

      {md5.length + soft.length + upload.warnings.length > 0 ? (
        <div className="space-y-2">
          {md5.map((d) => (
            <Notice key={d.path} tone="strong">
              <p className="font-medium">Questo file è già nella libreria.</p>
              <p className="mt-0.5 break-all text-muted-foreground">
                <code className="text-xs">{d.path}</code>
                {d.bookId ? (
                  <>
                    {" "}
                    ·{" "}
                    <Link
                      to={libraryPath(`book/${d.bookId}`)}
                      className="text-brand underline underline-offset-4"
                    >
                      vai al libro
                    </Link>
                  </>
                ) : null}
              </p>
            </Notice>
          ))}
          {soft.map((d) => (
            <Notice key={d.bookId} tone="soft">
              <p>
                Esiste già un libro con lo stesso titolo e autore:{" "}
                <Link
                  to={libraryPath(`book/${d.bookId}`)}
                  className="font-medium text-brand underline underline-offset-4"
                >
                  {d.title}
                </Link>
                {d.authors.length ? ` (${d.authors.join(", ")})` : ""}. Potrebbe essere un’altra
                edizione.
              </p>
            </Notice>
          ))}
          {upload.warnings.map((w, i) => (
            <Notice key={i} tone="info">
              {w}
            </Notice>
          ))}
        </div>
      ) : null}

      <BookFormFields
        idPrefix="new"
        value={state}
        onChange={setState}
        topics={topics}
        allTags={allTags}
        errors={showErrors ? errors : {}}
        disabled={busy}
      />

      <CoverPicker
        legend="Copertina"
        options={options}
        value={cover}
        onChange={setCover}
        disabled={busy}
      />
      {!epub && !ol ? (
        <p className="-mt-4 text-sm text-muted-foreground">
          Nessuna copertina trovata: verrà usato il segnaposto.
        </p>
      ) : null}

      {failure ? (
        <div
          role="alert"
          className="space-y-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm"
        >
          <p className="font-medium">Il libro non è stato aggiunto.</p>
          <p>{friendlyMessage(failure)}</p>
          {!expired ? (
            <p className="text-muted-foreground">
              Il repository è rimasto invariato. Puoi riprovare: il file caricato a metà non viene
              duplicato.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-5">
        <Button type="button" variant="ghost" onClick={cancel} disabled={busy}>
          Annulla
        </Button>
        {expired ? (
          <Button type="button" onClick={cancel}>
            Ricomincia
          </Button>
        ) : (
          <Button type="submit" disabled={busy} data-testid="create-book">
            {busy ? (
              <>
                <Loader2Icon className="animate-spin" />
                Conversione e invio al Kobo…
              </>
            ) : failure ? (
              <>
                <RefreshCwIcon />
                Riprova
              </>
            ) : (
              "Aggiungi alla biblioteca"
            )}
          </Button>
        )}
      </div>
      {busy ? (
        <p className="-mt-3 text-right text-xs text-muted-foreground" aria-live="polite">
          Può richiedere qualche decina di secondi: non chiudere la pagina.
        </p>
      ) : null}
    </form>
  );
}

/** Upload handed over by the Z-Library search (router state), if present and valid. */
function uploadFromLocationState(state: unknown): UploadResponse | null {
  const incoming = (state as { zlibraryUpload?: unknown } | null)?.zlibraryUpload;
  if (incoming === undefined) return null;
  const parsed = UploadResponseSchema.safeParse(incoming);
  return parsed.success ? parsed.data : null;
}

export function UploadPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const hasHandoff =
    (location.state as { zlibraryUpload?: unknown } | null)?.zlibraryUpload !== undefined;
  const [stage, setStage] = useState<Stage>(() => {
    const upload = uploadFromLocationState(location.state);
    return upload ? { kind: "form", upload } : { kind: "pick" };
  });

  // Clear the handoff from the history entry so a reload does not reuse the staged upload.
  useEffect(() => {
    if (hasHandoff) {
      void navigate(location.pathname, { replace: true, state: null });
    }
  }, [hasHandoff, location.pathname, navigate]);

  // Incremented to remount the form after "Annulla" (only "Annulla" discards the staging; leaving the page keeps it until the 24 h cleanup).
  const [formKey, setFormKey] = useState(0);

  const onFile = useCallback(async (file: File) => {
    if (!/\.epub$/i.test(file.name)) {
      setStage({ kind: "pick", error: "Il file deve avere estensione .epub." });
      return;
    }
    if (file.size > EPUB_MAX_BYTES) {
      setStage({ kind: "pick", error: `Il file supera il limite di ${EPUB_MAX_MIB} MiB.` });
      return;
    }
    setStage({ kind: "analyzing", fileName: file.name });
    try {
      const upload = await adminApi.uploadEpub(file);
      setFormKey((k) => k + 1);
      setStage({ kind: "form", upload });
    } catch (error) {
      setStage({ kind: "pick", error: friendlyMessage(error) });
    }
  }, []);

  const reset = useCallback(() => {
    toast.dismiss();
    setStage({ kind: "pick" });
  }, []);

  return (
    <AdminPage
      title="Aggiungi libro"
      intro={
        stage.kind === "form"
          ? "Controlla i dati estratti dall’EPUB, scegli la copertina e conferma."
          : "Carica un EPUB: i metadati vengono letti dal file e potrai correggerli prima di confermare."
      }
    >
      {stage.kind === "pick" ? (
        <Dropzone onFile={(f) => void onFile(f)} error={stage.error} />
      ) : null}
      {stage.kind === "analyzing" ? (
        <div
          role="status"
          className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-6 py-16 text-center"
        >
          <Loader2Icon aria-hidden className="size-8 animate-spin text-brand" />
          <p className="font-serif text-xl">Analisi di {stage.fileName}…</p>
          <p className="text-sm text-muted-foreground">
            Lettura dei metadati, ricerca della copertina e controllo dei duplicati nella libreria.
          </p>
        </div>
      ) : null}
      {stage.kind === "form" ? (
        <UploadForm key={formKey} upload={stage.upload} onCancel={reset} />
      ) : null}
    </AdminPage>
  );
}
