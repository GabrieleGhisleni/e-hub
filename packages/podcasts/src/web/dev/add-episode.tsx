import { useState } from "react";
import { Link2, Loader2, Plus } from "lucide-react";
import { useNavigate } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@ehub/ui/components/alert";
import { Button } from "@ehub/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@ehub/ui/components/dialog";
import { Input } from "@ehub/ui/components/input";
import { Label } from "@ehub/ui/components/label";
import { episodePath } from "@podcasts/lib/paths";
import { api, ApiError, describeError, type AddPreview } from "./api";
import { flashAfterWrite } from "./storage";

type Ready = Extract<AddPreview, { status: "ready" }>;

/** "none" = no feed; "custom" = the URL typed below; otherwise a candidate's feed URL. */
type FeedChoice = string;
const NO_FEED = "none";
const CUSTOM_FEED = "custom";

/** Header button + dialog "Aggiungi da URL" (DESIGN.md §8.5). */
export function AddEpisodeButton({ variant = "outline" }: { variant?: "outline" | "default" }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size="sm">
          <Plus aria-hidden /> Aggiungi da URL
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <AddEpisodeForm onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AddEpisodeForm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<AddPreview>();
  const [busy, setBusy] = useState<"preview" | "add">();
  const [error, setError] = useState<string>();
  const [choice, setChoice] = useState<FeedChoice>();
  const [customFeed, setCustomFeed] = useState("");

  const runPreview = async () => {
    setBusy("preview");
    setError(undefined);
    setPreview(undefined);
    setChoice(undefined);
    try {
      const result = await api.preview(url.trim());
      setPreview(result);
      // Never preselect a feed: iTunes "exact" matches can be wrong; the user decides.
      if (result.status === "ready" && result.show.status === "new") {
        setChoice(result.show.needsFeedDecision ? undefined : NO_FEED);
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(undefined);
    }
  };

  const feedValue = (): string | null | undefined => {
    if (!preview || preview.status !== "ready" || preview.show.status !== "new") return undefined;
    if (!preview.show.needsFeedDecision) return undefined;
    if (choice === NO_FEED) return null;
    if (choice === CUSTOM_FEED) return customFeed.trim();
    return choice;
  };

  const needsChoice =
    preview?.status === "ready" &&
    preview.show.status === "new" &&
    preview.show.needsFeedDecision &&
    (choice === undefined || (choice === CUSTOM_FEED && customFeed.trim() === ""));

  const runAdd = async () => {
    setBusy("add");
    setError(undefined);
    try {
      const result = await api.add(url.trim(), feedValue());
      const slug = result.status === "created" ? result.episode.slug : result.existing.slug;
      if (result.status === "created") {
        flashAfterWrite(
          "success",
          `Episodio aggiunto: ${result.episode.title}`,
          result.transcript.status === "none"
            ? "Nessuna trascrizione: usa «pnpm transcribe» per generarla."
            : `Trascrizione salvata (${result.transcript.segments} segmenti).`,
        );
      } else {
        flashAfterWrite("info", "Episodio già presente: aperto quello esistente.");
      }
      onDone();
      // Vite reloads the page when the data files change; a plain navigation could be lost.
      window.location.assign(episodePath(slug));
    } catch (e) {
      if (e instanceof ApiError && e.code === "feed-decision-required") {
        setError("Scegli il feed del podcast (o «nessun feed») prima di aggiungere.");
      } else {
        setError(describeError(e));
      }
      setBusy(undefined);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Aggiungi da URL</DialogTitle>
        <DialogDescription>
          Pagina di un episodio (Lex Fridman, Huberman Lab) o video YouTube. L'anteprima non scrive
          nulla.
        </DialogDescription>
      </DialogHeader>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (url.trim() && !busy) void runPreview();
        }}
      >
        <div className="relative flex-1">
          <Label htmlFor="add-url" className="sr-only">
            URL dell'episodio
          </Label>
          <Link2
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="add-url"
            type="url"
            inputMode="url"
            required
            placeholder="https://www.youtube.com/watch?v=…"
            className="pl-8"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setPreview(undefined);
              setError(undefined);
            }}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={!url.trim() || busy !== undefined}>
          {busy === "preview" && <Loader2 className="animate-spin" aria-hidden />}
          Anteprima
        </Button>
      </form>

      {busy === "preview" && (
        <output className="block text-sm text-muted-foreground">
          Recupero i dati… la prima volta (indice Lex, clone della wiki Huberman) può richiedere
          qualche secondo.
        </output>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Non riuscito</AlertTitle>
          <AlertDescription className="whitespace-pre-line">{error}</AlertDescription>
        </Alert>
      )}

      {preview?.status === "duplicate" && (
        <Alert>
          <AlertTitle>Episodio già presente</AlertTitle>
          <AlertDescription>
            <span>{preview.existing.title}</span>
            <Button
              variant="link"
              className="h-auto p-0"
              onClick={() => {
                void navigate(episodePath(preview.existing.slug));
                onDone();
              }}
            >
              Apri l'episodio
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {preview?.status === "ready" && (
        <PreviewSummary
          preview={preview}
          choice={choice}
          onChoice={setChoice}
          customFeed={customFeed}
          onCustomFeed={setCustomFeed}
        />
      )}

      {preview?.status === "ready" && (
        <DialogFooter>
          <Button onClick={() => void runAdd()} disabled={busy !== undefined || needsChoice}>
            {busy === "add" && <Loader2 className="animate-spin" aria-hidden />}
            {busy === "add" ? "Aggiungo…" : "Aggiungi episodio"}
          </Button>
        </DialogFooter>
      )}
    </>
  );
}

function PreviewSummary({
  preview,
  choice,
  onChoice,
  customFeed,
  onCustomFeed,
}: {
  preview: Ready;
  choice: FeedChoice | undefined;
  onChoice: (choice: FeedChoice) => void;
  customFeed: string;
  onCustomFeed: (value: string) => void;
}) {
  const { episode, show, transcript } = preview;
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-muted-foreground">Titolo</dt>
        <dd className="font-medium">
          {episode.title}
          {episode.number !== undefined && (
            <span className="ml-2 font-normal text-muted-foreground">#{episode.number}</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Ospiti</dt>
        <dd>{episode.guests.length > 0 ? episode.guests.join(", ") : "—"}</dd>
        <dt className="text-muted-foreground">Show</dt>
        <dd>
          {show.name}
          {show.status === "new" && (
            <span className="ml-2 rounded-full border px-2 py-0.5 text-xs">nuovo</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Trascrizione</dt>
        <dd>
          {transcript.status === "available"
            ? `disponibile (${transcript.source})`
            : `nessuna — ${transcript.reason}`}
        </dd>
      </dl>

      {preview.warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {preview.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {show.status === "new" && show.needsFeedDecision && (
        <fieldset className="space-y-2 rounded-lg border p-3">
          <legend className="px-1 font-medium">Feed del podcast per il nuovo show</legend>
          <p className="text-muted-foreground">
            Il feed serve a trovare l'audio per la trascrizione locale. Controlla che sia quello
            giusto.
          </p>
          {show.feedCandidates.map((candidate) => (
            <FeedOption
              key={candidate.feedUrl}
              value={candidate.feedUrl}
              checked={choice === candidate.feedUrl}
              onChange={onChoice}
            >
              <span className="font-medium">{candidate.title}</span>
              <span className="text-muted-foreground">
                {" "}
                · {candidate.author}
                {candidate.episodeCount !== undefined &&
                  ` · ${candidate.episodeCount} episodi`} ·{" "}
                {candidate.match === "exact"
                  ? "corrispondenza esatta"
                  : candidate.match === "partial"
                    ? "parziale"
                    : "debole"}
              </span>
              <span className="block text-xs break-all text-muted-foreground">
                {candidate.feedUrl}
              </span>
            </FeedOption>
          ))}
          <FeedOption value={CUSTOM_FEED} checked={choice === CUSTOM_FEED} onChange={onChoice}>
            Un altro feed (URL)
          </FeedOption>
          {choice === CUSTOM_FEED && (
            <Input
              type="url"
              aria-label="URL del feed"
              placeholder="https://…/feed.xml"
              value={customFeed}
              onChange={(event) => onCustomFeed(event.target.value)}
            />
          )}
          <FeedOption value={NO_FEED} checked={choice === NO_FEED} onChange={onChoice}>
            Nessun feed
          </FeedOption>
        </fieldset>
      )}
    </div>
  );
}

function FeedOption({
  value,
  checked,
  onChange,
  children,
}: {
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-md p-1.5 hover:bg-accent has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50">
      <input
        type="radio"
        name="feed-choice"
        className="mt-1 accent-[var(--brand)]"
        checked={checked}
        onChange={() => onChange(value)}
      />
      <span className="flex-1">{children}</span>
    </label>
  );
}
