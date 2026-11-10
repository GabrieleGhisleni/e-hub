import { CheckIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { TopicUsage } from "@shared/api";
import { UNSORTED_TOPIC_ID, UNSORTED_TOPIC_LABEL } from "@shared/labels";
import { ErrorState } from "@library/components/states";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@ehub/ui/components/alert-dialog";
import { Button } from "@ehub/ui/components/button";
import { Input } from "@ehub/ui/components/input";
import { Skeleton } from "@ehub/ui/components/skeleton";
import { adminApi } from "./api";
import { AdminPage } from "./admin-page";
import { friendlyMessage } from "./lib/errors";
import { announceError, announceWrite } from "./notify";

function bookCountText(n: number): string {
  return n === 1 ? "1 libro" : `${n} libri`;
}

function TopicRow({
  topic,
  disabled,
  onRename,
  onDelete,
}: {
  topic: TopicUsage;
  disabled: boolean;
  onRename: (label: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(topic.label);
  const [busy, setBusy] = useState(false);
  const protectedTopic = topic.id === UNSORTED_TOPIC_ID;

  async function save() {
    const next = label.trim();
    if (next === "" || next === topic.label) {
      setEditing(false);
      setLabel(topic.label);
      return;
    }
    setBusy(true);
    const ok = await onRename(next);
    setBusy(false);
    if (ok) setEditing(false);
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      {editing ? (
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-label={`Nuovo nome per ${topic.label}`}
            disabled={busy}
            className="max-w-xs"
          />
          <Button type="submit" size="icon-sm" disabled={busy} aria-label="Salva nome">
            {busy ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label="Annulla"
            onClick={() => {
              setEditing(false);
              setLabel(topic.label);
            }}
          >
            <XIcon />
          </Button>
        </form>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <span className="font-serif text-lg">{topic.label}</span>
            {protectedTopic ? (
              <span className="ml-2 text-xs text-muted-foreground">sempre presente</span>
            ) : null}
          </div>
          <span className="text-sm text-muted-foreground tabular-nums">
            {bookCountText(topic.bookCount)}
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => setEditing(true)}
              aria-label={`Rinomina ${topic.label}`}
            >
              <PencilIcon />
              Rinomina
            </Button>
            {protectedTopic ? null : (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={onDelete}
                aria-label={`Elimina ${topic.label}`}
                className="text-destructive hover:text-destructive"
              >
                <Trash2Icon />
                Elimina
              </Button>
            )}
          </div>
        </>
      )}
    </li>
  );
}

export function TopicsPage() {
  const [topics, setTopics] = useState<TopicUsage[] | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [toDelete, setToDelete] = useState<TopicUsage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  // The "unsorted" topic can be renamed: messages use its current label.
  const unsortedLabel =
    topics?.find((t) => t.id === UNSORTED_TOPIC_ID)?.label ?? UNSORTED_TOPIC_LABEL;

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await adminApi.listTopics(signal);
      setTopics(response.topics);
      setLoadError(null);
    } catch (e) {
      if (signal?.aborted) return;
      setLoadError(new Error(friendlyMessage(e)));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function add() {
    const label = newLabel.trim();
    if (label === "" || adding) return;
    setAdding(true);
    try {
      const response = await adminApi.addTopic(label);
      announceWrite(`Argomento «${response.topic.label}» aggiunto`, response.report);
      setNewLabel("");
      await load();
    } catch (e) {
      announceError("Argomento non aggiunto", e);
    }
    setAdding(false);
  }

  async function rename(topic: TopicUsage, label: string): Promise<boolean> {
    setBusy(true);
    try {
      const response = await adminApi.renameTopic(topic.id, label);
      announceWrite(`Argomento rinominato in «${response.topic.label}»`, response.report);
      await load();
      return true;
    } catch (e) {
      announceError("Argomento non rinominato", e);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!toDelete || deleting) return;
    setDeleting(true);
    try {
      const response = await adminApi.deleteTopic(toDelete.id);
      announceWrite(
        response.reassigned > 0
          ? `Argomento «${toDelete.label}» eliminato · ${bookCountText(response.reassigned)} in «${unsortedLabel}»`
          : `Argomento «${toDelete.label}» eliminato`,
        response.report,
      );
      setToDelete(null);
      await load();
    } catch (e) {
      announceError("Argomento non eliminato", e);
    }
    setDeleting(false);
  }

  return (
    <AdminPage
      title="Argomenti"
      intro="L’argomento di un libro decide la cartella su Drive. Rinominare un argomento rinomina le cartelle su Drive (Kobo e Archivio); i libri non cambiano."
    >
      {loadError ? (
        <ErrorState
          title="Impossibile caricare gli argomenti"
          error={loadError}
          onRetry={() => void load()}
        />
      ) : topics === null ? (
        <div className="space-y-3" aria-busy>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border border-y border-border" aria-label="Argomenti">
            {topics.map((topic) => (
              <TopicRow
                key={topic.id}
                topic={topic}
                disabled={busy}
                onRename={(label) => rename(topic, label)}
                onDelete={() => setToDelete(topic)}
              />
            ))}
          </ul>

          <form
            className="mt-8 flex max-w-md flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Nuovo argomento"
              aria-label="Nome del nuovo argomento"
              disabled={adding}
              className="min-w-0 flex-1"
            />
            <Button type="submit" disabled={adding || newLabel.trim() === ""}>
              {adding ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
              Aggiungi
            </Button>
          </form>
        </>
      )}

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && !deleting && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare «{toDelete?.label}»?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete && toDelete.bookCount > 0
                ? `${bookCountText(toDelete.bookCount)} ${toDelete.bookCount === 1 ? "verrà spostato" : "verranno spostati"} in «${unsortedLabel}», e i file cambieranno cartella su Drive.`
                : "Nessun libro usa questo argomento."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annulla</AlertDialogCancel>
            <Button variant="destructive" onClick={() => void remove()} disabled={deleting}>
              {deleting ? (
                <>
                  <Loader2Icon className="animate-spin" />
                  Eliminazione…
                </>
              ) : (
                "Elimina argomento"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminPage>
  );
}
