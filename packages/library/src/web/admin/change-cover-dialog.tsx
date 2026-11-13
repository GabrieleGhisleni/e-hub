import { ImagePlusIcon, Loader2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CoverCandidatesResponse } from "@shared/api";
import type { BookDetail } from "@shared/schema";
import { BookCover } from "@library/components/book-cover";
import { Button } from "@ehub/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ehub/ui/components/dialog";
import { adminApi, bookCoverCandidateUrl } from "./api";
import { CoverPicker, type CoverOption } from "./cover-picker";
import { openLibraryIdFor } from "./lib/covers";
import { friendlyMessage } from "./lib/errors";
import { announceError, announceWrite } from "./notify";

type Load =
  | { status: "loading" }
  | { status: "ready"; data: CoverCandidatesResponse }
  | { status: "error"; message: string };

function Picker({ book, onDone }: { book: BookDetail; onDone: () => void }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [choice, setChoice] = useState("current");
  const [image, setImage] = useState<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    adminApi
      .coverCandidates(book.id, controller.signal)
      .then((data) => setLoad({ status: "ready", data }))
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ status: "error", message: friendlyMessage(e) });
      });
    return () => controller.abort();
  }, [book.id]);

  useEffect(() => () => (image ? URL.revokeObjectURL(image.url) : undefined), [image]);

  const candidates = load.status === "ready" ? load.data.candidates : [];
  const epub = candidates.find((c) => c.source === "epub");
  const ol = candidates.find((c) => c.source === "openlibrary");

  const options: CoverOption[] = [
    {
      key: "current",
      label: "Attuale",
      fallback: (
        <BookCover book={{ ...book, coverUrl: book.coverUrl }} className="size-full shadow-none" />
      ),
      caption: "Nessun cambiamento",
    },
  ];
  if (epub) {
    options.push({
      key: "epub",
      label: "Dall’EPUB",
      src: bookCoverCandidateUrl(book.id, "epub"),
      caption: epub.width && epub.height ? `${epub.width}×${epub.height}` : undefined,
    });
  }
  if (ol) {
    options.push({
      key: "openlibrary",
      label: "Open Library",
      src: bookCoverCandidateUrl(book.id, "openlibrary"),
      badge: ol.needsConfirmation ? "da confermare" : undefined,
      caption: ol.needsConfirmation
        ? `Trovata per titolo e autore${ol.title ? `: ${ol.title}` : ""}. Spesso è un’altra edizione.`
        : "Trovata tramite ISBN",
    });
  }
  options.push({
    key: "placeholder",
    label: "Segnaposto",
    caption: "Generato da titolo e autore",
    fallback: <BookCover book={{ ...book, coverUrl: null }} className="size-full shadow-none" />,
  });
  options.push({
    key: "upload",
    label: "Immagine",
    src: image?.url,
    caption: image ? image.file.name : "Carica un file JPG, PNG o WebP",
    fallback: (
      <div className="flex size-full flex-col items-center justify-center gap-2 p-2 text-center text-xs text-muted-foreground">
        <ImagePlusIcon aria-hidden className="size-6" />
        Scegli un file…
      </div>
    ),
  });

  function onChoose(key: string) {
    if (key === "upload") fileInput.current?.click();
    else setChoice(key);
  }

  async function apply() {
    if (choice === "current" || busy) return;
    setBusy(true);
    try {
      const response =
        choice === "upload" && image
          ? await adminApi.uploadCoverImage(book.id, image.file)
          : await adminApi.setCover(book.id, {
              source: choice as "epub" | "openlibrary" | "placeholder",
              openLibraryCoverId: openLibraryIdFor(choice as "openlibrary", candidates),
            });
      announceWrite("Copertina aggiornata", response.report);
      onDone();
    } catch (e) {
      announceError("Copertina non aggiornata", e);
      setBusy(false);
    }
  }

  return (
    <>
      {load.status === "loading" ? (
        <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          Ricerca delle copertine (legge l’EPUB dalla cache sul PC)…
        </p>
      ) : null}
      {load.status === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {load.message} Puoi comunque scegliere il segnaposto o caricare un’immagine.
        </p>
      ) : null}
      {load.status === "ready" && load.data.warnings.length > 0 ? (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {load.data.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
      {load.status !== "loading" ? (
        <CoverPicker
          legend="Scegli la nuova copertina"
          options={options}
          value={choice}
          onChange={onChoose}
          disabled={busy}
        />
      ) : null}
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        aria-label="Immagine di copertina"
        data-testid="cover-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setImage({ file, url: URL.createObjectURL(file) });
          setChoice("upload");
        }}
      />
      <DialogFooter>
        <Button variant="ghost" onClick={onDone} disabled={busy}>
          Annulla
        </Button>
        <Button onClick={() => void apply()} disabled={busy || choice === "current"}>
          {busy ? (
            <>
              <Loader2Icon className="animate-spin" />
              Salvataggio…
            </>
          ) : (
            "Usa questa copertina"
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

export function ChangeCoverDialog({
  book,
  open,
  onOpenChange,
}: {
  book: BookDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cambia copertina</DialogTitle>
          <DialogDescription>
            La copertina vive solo nel repository (cover.webp): il Kobo non viene toccato.
          </DialogDescription>
        </DialogHeader>
        {open ? <Picker book={book} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
