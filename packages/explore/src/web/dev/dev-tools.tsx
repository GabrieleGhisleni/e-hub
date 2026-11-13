/*
 * Local-only explorations UI (the dev server): chat, proposals, verdicts, sources, notes, EPUB uploads. Loaded
 * lazily through `../dev-slots.tsx`, so none of this code is in the static build.
 */
import { CheckIcon, CompassIcon, PencilIcon, PlusIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { ChatButton, type ToolPartInfo } from "@ehub/chat/web";
import { Container, PageHeader } from "@ehub/ui";
import { Button } from "@ehub/ui/components/button";
import { Checkbox } from "@ehub/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ehub/ui/components/dialog";
import { Input } from "@ehub/ui/components/input";
import { Label } from "@ehub/ui/components/label";
import { Textarea } from "@ehub/ui/components/textarea";
import { Toaster } from "@ehub/ui/components/sonner";
import { VERDICT_LABELS, formatVerdict, type VerdictDecision } from "../../labels.ts";
import type { BookSource, Exploration } from "../../schema.ts";
import { explorationHref } from "../format.ts";
import {
  type ExploreStore,
  type LibraryBookRef,
  type VerdictInput,
} from "../store.ts";
import { PROPOSAL_TOOL, parseChapterText, readProposal } from "../proposal-input.ts";
import { notebookChunk } from "../notebook-input.ts";
import { NotebookProposalCard } from "./notebook-proposal.tsx";
import { PROPOSE_NOTEBOOK_TOOL } from "../../chat/notebook.ts";
import type { ProposeVerdictsInput } from "../../chat/proposal.ts";

const EXPLORATION_SUGGESTIONS = [
  "Cosa dicono le fonti sulla domanda?",
  "Quali capitoli leggere per primi?",
  "Proponi i verdetti",
  "Riorganizza il quaderno",
];

const DECISION_OPTIONS = (Object.keys(VERDICT_LABELS) as VerdictDecision[]).map((value) => ({
  value,
  label: VERDICT_LABELS[value],
}));

const FIELD =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/20 disabled:opacity-50 dark:bg-input/30";

/** Runs a store call, shows its Italian message as a toast on failure. */
function useRun() {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>, success?: string): Promise<boolean> => {
    setBusy(true);
    try {
      await action();
      if (success) toast.success(success);
      return true;
    } catch (error) {
      toast.error((error as Error).message || "Operazione non riuscita.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** Verdict form shared by the source dialog and the proposal rows: decision, chapters (for parts), reason. */
function VerdictFields({
  decision,
  chapters,
  reason,
  onChange,
  disabled,
  label,
}: {
  decision: VerdictDecision;
  chapters: string;
  reason: string;
  onChange: (next: { decision: VerdictDecision; chapters: string; reason: string }) => void;
  disabled?: boolean;
  label: string;
}) {
  const id = useId();
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-decision`}>Verdetto</Label>
        <select
          id={`${id}-decision`}
          aria-label={`Verdetto per ${label}`}
          className={FIELD}
          value={decision}
          disabled={disabled}
          onChange={(event) =>
            onChange({ decision: event.target.value as VerdictDecision, chapters, reason })
          }
        >
          {DECISION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {decision === "parts" ? (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-chapters`}>Capitoli</Label>
          <Input
            id={`${id}-chapters`}
            aria-label={`Capitoli per ${label}`}
            placeholder="es. 2, 5"
            value={chapters}
            disabled={disabled}
            onChange={(event) => onChange({ decision, chapters: event.target.value, reason })}
          />
        </div>
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-reason`}>Motivazione</Label>
        <Input
          id={`${id}-reason`}
          aria-label={`Motivazione per ${label}`}
          maxLength={500}
          value={reason}
          disabled={disabled}
          onChange={(event) => onChange({ decision, chapters, reason: event.target.value })}
        />
      </div>
    </div>
  );
}

/** Builds the verdict the server takes from the form fields; a message when they are not valid. */
function verdictFromFields(
  fields: { decision: VerdictDecision; chapters: string; reason: string },
  label: string,
): VerdictInput | string {
  const reason = fields.reason.trim();
  if (reason === "") return `Scrivi una motivazione per ${label}.`;
  if (fields.decision !== "parts") return { decision: fields.decision, reason };
  const chapters = parseChapterText(fields.chapters);
  if (!chapters) return `Indica i capitoli di ${label}, es. 2, 5.`;
  return { decision: "parts", chapters, reason };
}

/** Local-only bar above the sources: chat, add a library book, upload an EPUB, close or reopen. */
export function ExplorationDevToolbar({
  exploration,
  store,
}: {
  exploration: Exploration;
  store: ExploreStore;
}) {
  const { busy, run } = useRun();
  const [adding, setAdding] = useState(false);
  const closed = exploration.status === "closed";
  const taken = new Set(exploration.sources.map((s) => s.id));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Toaster position="bottom-right" closeButton />
      <ChatButton
        source={{ kind: "exploration", id: exploration.id }}
        title={exploration.title}
        subtitle={exploration.question}
        suggestions={EXPLORATION_SUGGESTIONS}
        onSaveNote={async (note) => {
          // A failed save throws: the chat tells the model the note was not saved, with the reason.
          try {
            await store.appendNotebook(exploration.id, notebookChunk(note));
            toast.success("Aggiunto al quaderno");
          } catch (error) {
            toast.error((error as Error).message || "Operazione non riuscita.");
            throw error;
          }
        }}
        noteLabels={{
          save: "Aggiungi al quaderno",
          saved: "Nel quaderno",
          savedOutput: "Aggiunto in fondo al quaderno.",
          savedTitle: "Aggiunto al quaderno",
          placeholder: "Fai una domanda, o chiedi di aggiungere al quaderno",
        }}
        renderToolPart={(part: ToolPartInfo) => {
          if (part.toolName === PROPOSAL_TOOL) {
            return <ProposalCard key={part.toolCallId} exploration={exploration} part={part} store={store} />;
          }
          if (part.toolName === PROPOSE_NOTEBOOK_TOOL) {
            return (
              <NotebookProposalCard key={part.toolCallId} exploration={exploration} part={part} store={store} />
            );
          }
          return undefined;
        }}
      />

      <Button variant="outline" onClick={() => setAdding(true)} disabled={busy}>
        <PlusIcon aria-hidden /> Aggiungi libro
      </Button>
      <Label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium shadow-xs hover:bg-muted">
        <UploadIcon aria-hidden className="size-4" /> Carica EPUB
        <input
          type="file"
          accept=".epub,application/epub+zip"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void run(() => store.uploadEpub(exploration.id, file), "EPUB caricato");
          }}
        />
      </Label>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() =>
          void run(
            () => store.update(exploration.id, { status: closed ? "open" : "closed" }),
            closed ? "Esplorazione riaperta" : "Esplorazione chiusa",
          )
        }
      >
        {closed ? "Riapri" : "Chiudi"}
      </Button>

      <AddBookDialog
        open={adding}
        onOpenChange={setAdding}
        store={store}
        exploration={exploration}
        taken={taken}
      />
    </div>
  );
}

function AddBookDialog({
  open,
  onOpenChange,
  store,
  exploration,
  taken,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: ExploreStore;
  exploration: Exploration;
  taken: ReadonlySet<string>;
}) {
  const [books, setBooks] = useState<LibraryBookRef[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const { busy, run } = useRun();

  useEffect(() => {
    if (!open) return;
    let current = true;
    setFailure(null);
    store.libraryBooks().then(
      (list) => {
        if (current) setBooks(list);
      },
      (error: unknown) => {
        if (current) setFailure((error as Error).message);
      },
    );
    return () => {
      current = false;
    };
  }, [open, store]);

  const available = (books ?? []).filter((b) => !taken.has(b.id));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Aggiungi un libro della libreria</DialogTitle>
          <DialogDescription>Il libro resta in libreria: si esplora il suo testo già in cache.</DialogDescription>
        </DialogHeader>
        {failure ? <p className="text-sm text-destructive">{failure}</p> : null}
        {books === null && !failure ? <p className="text-sm text-muted-foreground">Caricamento…</p> : null}
        {books !== null && available.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun altro libro disponibile.</p>
        ) : null}
        <ul className="flex flex-col divide-y divide-border">
          {available.map((book) => (
            <li key={book.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{book.title}</p>
                <p className="truncate text-xs text-muted-foreground">{book.authors.join(", ")}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  const ok = await run(
                    () => store.addBook(exploration.id, book.id),
                    `Aggiunto: ${book.title}`,
                  );
                  if (ok) onOpenChange(false);
                }}
              >
                Aggiungi
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** Edit the verdict of one source, or remove the source from the exploration. */
export function SourceDevActions({
  exploration,
  source,
  store,
}: {
  exploration: Exploration;
  source: BookSource;
  store: ExploreStore;
}) {
  const { busy, run } = useRun();
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState({
    decision: source.verdict?.decision ?? ("undecided" as VerdictDecision),
    chapters: source.verdict?.decision === "parts" ? source.verdict.chapters.join(", ") : "",
    reason: source.verdict?.reason ?? "",
  });

  const save = async () => {
    const verdict = verdictFromFields(fields, source.title);
    if (typeof verdict === "string") {
      toast.error(verdict);
      return;
    }
    const ok = await run(
      () => store.setVerdict(exploration.id, source.id, verdict),
      "Verdetto salvato",
    );
    if (ok) setEditing(false);
  };

  return (
    <div className="mt-1 flex flex-wrap justify-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          setFields({
            decision: source.verdict?.decision ?? "undecided",
            chapters: source.verdict?.decision === "parts" ? source.verdict.chapters.join(", ") : "",
            reason: source.verdict?.reason ?? "",
          });
          setEditing(true);
        }}
      >
        <PencilIcon aria-hidden /> Modifica verdetto
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          if (!window.confirm(`Rimuovere «${source.title}» dall'esplorazione?`)) return;
          void run(() => store.removeBook(exploration.id, source.id), "Fonte rimossa");
        }}
      >
        <Trash2Icon aria-hidden /> Rimuovi
      </Button>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Verdetto per «{source.title}»</DialogTitle>
            <DialogDescription>Il verdetto si salva subito, con la motivazione.</DialogDescription>
          </DialogHeader>
          <VerdictFields
            label={source.title}
            decision={fields.decision}
            chapters={fields.chapters}
            reason={fields.reason}
            disabled={busy}
            onChange={setFields}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Annulla
            </Button>
            <Button disabled={busy} onClick={() => void save()}>
              Salva verdetto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Adds a note to the exploration, optionally about one of its sources. */
export function NoteDevComposer({
  exploration,
  store,
}: {
  exploration: Exploration;
  store: ExploreStore;
}) {
  const { busy, run } = useRun();
  const [body, setBody] = useState("");
  const [book, setBook] = useState("");
  const id = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (body.trim() === "") return;
    const ok = await run(
      () => store.addNote(exploration.id, book ? { body, book } : { body }),
      "Nota aggiunta",
    );
    if (ok) setBody("");
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-2 rounded-xl border border-border bg-card p-4">
      <Label htmlFor={`${id}-body`}>Nuova nota</Label>
      <Textarea
        id={`${id}-body`}
        rows={3}
        value={body}
        disabled={busy}
        placeholder="Che cosa emerge da questa fonte?"
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select
          aria-label="Libro della nota"
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm dark:bg-input/30"
          value={book}
          onChange={(event) => setBook(event.target.value)}
        >
          <option value="">Su tutta l’esplorazione</option>
          {exploration.sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.title}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={busy || body.trim() === ""}>
          <CheckIcon aria-hidden /> Aggiungi nota
        </Button>
      </div>
    </form>
  );
}

export function NoteDevDelete({
  exploration,
  noteId,
  store,
}: {
  exploration: Exploration;
  noteId: string;
  store: ExploreStore;
}) {
  const { busy, run } = useRun();
  return (
    <button
      type="button"
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
      onClick={() => {
        if (!window.confirm("Eliminare questa nota?")) return;
        void run(() => store.removeNote(exploration.id, noteId), "Nota eliminata");
      }}
    >
      <Trash2Icon aria-hidden className="size-3.5" /> Elimina
    </button>
  );
}

/** Link to the new-exploration page, in the list's header. */
export function NewExplorationLink() {
  return (
    <Button asChild>
      <Link to="/explore/new">
        <PlusIcon aria-hidden /> Nuova esplorazione
      </Link>
    </Button>
  );
}

// ---------------------------------------------------------------------------------------------
// The proposal card: the verdicts, summary and journal the chat proposed. Nothing is saved until "Conferma e salva".

interface RowDraft {
  include: boolean;
  decision: VerdictDecision;
  chapters: string;
  reason: string;
}

interface TextDraft {
  include: boolean;
  text: string;
}

export function ProposalCard({
  exploration,
  part,
  store,
}: {
  exploration: Exploration;
  part: ToolPartInfo;
  store: ExploreStore;
}) {
  if (part.state === "input-streaming") {
    return <p className="text-sm text-muted-foreground">Preparo la proposta…</p>;
  }
  const parsed = readProposal(part.input, exploration.sources);
  if (!parsed.ok) {
    return (
      <ProposalNotice>
        Non riesco a mostrare la proposta: {parsed.message} Nessuna modifica è stata fatta.
      </ProposalNotice>
    );
  }
  return (
    <ProposalForm
      exploration={exploration}
      proposal={parsed.value}
      store={store}
    />
  );
}

function ProposalNotice({ children }: { children: string | string[] }) {
  return (
    <div role="status" className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function ProposalForm({
  exploration,
  proposal,
  store,
}: {
  exploration: Exploration;
  proposal: ProposeVerdictsInput;
  store: ExploreStore;
}) {
  const { verdicts, summary, journal } = proposal;
  const [rows, setRows] = useState<RowDraft[]>(() =>
    verdicts.map((v) => ({
      include: true,
      decision: v.decision,
      chapters: v.chapters?.join(", ") ?? "",
      reason: v.reason,
    })),
  );
  const [summaryDraft, setSummaryDraft] = useState<TextDraft>({ include: true, text: summary ?? "" });
  const [journalDraft, setJournalDraft] = useState<TextDraft>({ include: true, text: journal ?? "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const titleOf = (book: string) => exploration.sources.find((s) => s.id === book)?.title ?? book;

  const updateRow = (index: number, patch: Partial<RowDraft>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const save = async () => {
    const writes: (() => Promise<unknown>)[] = [];
    for (let i = 0; i < verdicts.length; i += 1) {
      const row = rows[i];
      if (!row?.include) continue;
      const label = titleOf(verdicts[i].book);
      const verdict = verdictFromFields(row, label);
      if (typeof verdict === "string") {
        toast.error(verdict);
        return;
      }
      writes.push(() => store.setVerdict(exploration.id, verdicts[i].book, verdict));
    }
    if (summaryDraft.include && summaryDraft.text.trim() !== "") {
      const text = summaryDraft.text.trim();
      writes.push(() => store.update(exploration.id, { summary: text }));
    }
    if (journalDraft.include && journalDraft.text.trim() !== "") {
      const text = journalDraft.text.trim();
      writes.push(() => store.addJournal(exploration.id, text));
    }
    if (writes.length === 0) {
      toast.error("Seleziona almeno una voce da salvare.");
      return;
    }
    setSaving(true);
    try {
      for (const write of writes) await write();
      setSaved(true);
      toast.success("Salvato");
    } catch (error) {
      toast.error(`Salvataggio interrotto: ${(error as Error).message}`);
    } finally {
      // Whatever was written, show the server's copy.
      try {
        await store.fetchOne(exploration.id);
      } catch {
        // The list still shows the last good copy.
      }
      setSaving(false);
    }
  };

  const anyChecked = rows.some((r) => r.include) || summaryDraft.include || journalDraft.include;

  return (
    <section aria-label="Proposta di verdetti" className="rounded-xl border border-brand/30 bg-card p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <CompassIcon aria-hidden className="size-4 text-brand" /> Proposta di verdetti
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Niente è salvato finché non confermi. Puoi cambiare o deselezionare ogni voce.
      </p>

      <ul className="mt-4 flex flex-col gap-3">
        {verdicts.map((verdict, index) => {
          const row = rows[index];
          const source = exploration.sources.find((s) => s.id === verdict.book);
          const title = titleOf(verdict.book);
          return (
            <li key={`${verdict.book}-${index}`} className="rounded-lg border border-border p-3">
              <label className="flex items-start gap-2.5">
                <Checkbox
                  aria-label={`Includi ${title}`}
                  checked={row.include}
                  disabled={saving || saved}
                  onCheckedChange={(checked) => updateRow(index, { include: checked === true })}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block font-medium break-words">{title}</span>
                  <span className="block text-xs text-muted-foreground">
                    Attuale: {formatVerdict(source?.verdict)}
                  </span>
                </span>
              </label>
              <div className="mt-3">
                <VerdictFields
                  label={title}
                  decision={row.decision}
                  chapters={row.chapters}
                  reason={row.reason}
                  disabled={!row.include || saving || saved}
                  onChange={(next) => updateRow(index, next)}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {summary !== undefined ? (
        <TextProposal
          label="Sintesi"
          draft={summaryDraft}
          disabled={saving || saved}
          onChange={setSummaryDraft}
        />
      ) : null}
      {journal !== undefined ? (
        <TextProposal
          label="Diario"
          draft={journalDraft}
          disabled={saving || saved}
          onChange={setJournalDraft}
        />
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        {saved ? (
          <span role="status" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand">
            <CheckIcon aria-hidden className="size-4" /> Salvato
          </span>
        ) : (
          <Button onClick={() => void save()} disabled={saving || !anyChecked}>
            Conferma e salva
          </Button>
        )}
      </div>
    </section>
  );
}

function TextProposal({
  label,
  draft,
  disabled,
  onChange,
}: {
  label: string;
  draft: TextDraft;
  disabled: boolean;
  onChange: (next: TextDraft) => void;
}) {
  const id = useId();
  return (
    <div className="mt-4 grid gap-2 rounded-lg border border-border p-3">
      <label htmlFor={id} className="flex items-center gap-2.5 font-medium">
        <Checkbox
          aria-label={`Includi ${label.toLowerCase()}`}
          checked={draft.include}
          disabled={disabled}
          onCheckedChange={(checked) => onChange({ ...draft, include: checked === true })}
        />
        {label} proposta
      </label>
      <Textarea
        id={id}
        aria-label={`${label} proposta`}
        rows={4}
        value={draft.text}
        disabled={disabled || !draft.include}
        onChange={(event) => onChange({ ...draft, text: event.target.value })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The "new exploration" page (dev only): title, question, library books and EPUBs to explore.

export function NewExplorationPage({ store }: { store: ExploreStore }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [books, setBooks] = useState<LibraryBookRef[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const { busy, run } = useRun();
  const id = useId();

  useEffect(() => {
    document.title = "Nuova esplorazione · e-hub";
    let current = true;
    store.libraryBooks().then(
      (list) => {
        if (current) setBooks(list);
      },
      (error: unknown) => {
        toast.error((error as Error).message);
        if (current) setBooks([]);
      },
    );
    return () => {
      current = false;
    };
  }, [store]);

  const shown = (books ?? []).filter((b) =>
    `${b.title} ${b.authors.join(" ")}`.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (title.trim() === "" || question.trim() === "") {
      toast.error("Scrivi un titolo e una domanda.");
      return;
    }
    let created: Exploration | undefined;
    const ok = await run(async () => {
      created = await store.create({
        title: title.trim(),
        question: question.trim(),
        books: [...picked],
      });
    }, "Esplorazione creata");
    if (!ok || !created) return;
    for (const file of files) {
      const uploaded = await run(() => store.uploadEpub(created!.id, file), `EPUB caricato: ${file.name}`);
      if (!uploaded) break;
    }
    navigate(explorationHref(created.id));
  };

  return (
    <Container className="pt-6 pb-16 sm:pt-8">
      <Toaster position="bottom-right" closeButton />
      <PageHeader title="Nuova esplorazione" description="Una domanda e i libri su cui cercarla." />
      <form onSubmit={(event) => void submit(event)} className="mt-8 grid max-w-[44rem] gap-6">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-title`}>Titolo</Label>
          <Input id={`${id}-title`} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-question`}>Domanda</Label>
          <Textarea
            id={`${id}-question`}
            rows={3}
            maxLength={2000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </div>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Libri della libreria</legend>
          <Input
            aria-label="Cerca tra i libri"
            placeholder="Cerca per titolo o autore"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {books === null ? <p className="text-sm text-muted-foreground">Caricamento…</p> : null}
          <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {shown.map((book) => (
              <li key={book.id} className="flex items-center gap-3 px-3 py-2">
                <Checkbox
                  aria-label={`Includi ${book.title}`}
                  checked={picked.has(book.id)}
                  onCheckedChange={(checked) =>
                    setPicked((current) => {
                      const next = new Set(current);
                      if (checked === true) next.add(book.id);
                      else next.delete(book.id);
                      return next;
                    })
                  }
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{book.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{book.authors.join(", ")}</span>
                </span>
              </li>
            ))}
          </ul>
        </fieldset>

        <div className="grid gap-2">
          <span className="text-sm font-medium">EPUB solo da esplorare</span>
          <p className="text-xs text-muted-foreground">Non entrano in libreria: restano nella cache dell’esplorazione.</p>
          {/* Styled label instead of the browser's own file button (its text follows the browser language). */}
          <Label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium shadow-xs hover:bg-muted">
            <UploadIcon aria-hidden className="size-4" /> Scegli EPUB
            <input
              id={`${id}-epub`}
              type="file"
              accept=".epub,application/epub+zip"
              multiple
              className="sr-only"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </Label>
          {files.length > 0 ? (
            <ul className="text-sm text-muted-foreground">
              {files.map((file) => (
                <li key={file.name}>{file.name}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            Crea esplorazione
          </Button>
        </div>
      </form>
    </Container>
  );
}
