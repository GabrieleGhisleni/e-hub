/**
 * Admin bar above the library grid: add book, topics, and selection mode with bulk edit.
 */
import { CheckSquareIcon, FolderTreeIcon, PencilLineIcon, PlusIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Button } from "@ehub/ui/components/button";
import { useLibrarySelection } from "@library/selection";
import { BulkEditDialog } from "./bulk-edit-dialog";
import { collectTags } from "./lib/tags";
import { ADMIN_BUNDLE_MARKER } from "./marker";
import type { LibraryAdminBarProps } from "./types";
import { libraryPath } from "@library/lib/paths";

export function LibraryAdminBar({ index, visibleBooks }: LibraryAdminBarProps) {
  const selection = useLibrarySelection();
  const [bulkOpen, setBulkOpen] = useState(false);
  const count = selection.selectedIds.size;
  const selectedBooks = useMemo(
    () => index.books.filter((b) => selection.selectedIds.has(b.id)),
    [index.books, selection.selectedIds],
  );
  const allTags = useMemo(() => collectTags(index.books), [index.books]);
  const allVisibleSelected =
    visibleBooks.length > 0 && visibleBooks.every((b) => selection.selectedIds.has(b.id));

  return (
    <div
      data-elib-admin={ADMIN_BUNDLE_MARKER}
      role="toolbar"
      aria-label="Strumenti di amministrazione"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed border-brand/40 bg-brand-soft/60 px-3 py-2 text-sm"
    >
      <span className="w-full sm:mr-auto sm:w-auto">
        <span className="font-medium text-brand">Modalità locale</span>
        <span className="ml-2 text-xs text-muted-foreground">
          Le modifiche restano sul tuo computer: per pubblicare serve commit e push.
        </span>
      </span>
      {selection.selecting ? (
        <>
          <span className="tabular-nums text-muted-foreground" aria-live="polite">
            {count === 1 ? "1 selezionato" : `${count} selezionati`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              allVisibleSelected
                ? selection.clear()
                : selection.setSelected(visibleBooks.map((b) => b.id))
            }
            disabled={visibleBooks.length === 0}
          >
            {allVisibleSelected ? "Deseleziona tutti" : "Seleziona tutti i visibili"}
          </Button>
          {count > 0 && !allVisibleSelected ? (
            <Button variant="ghost" size="sm" onClick={selection.clear}>
              Azzera
            </Button>
          ) : null}
          <Button size="sm" disabled={count === 0} onClick={() => setBulkOpen(true)}>
            <PencilLineIcon />
            Modifica in blocco
          </Button>
          <Button variant="ghost" size="sm" onClick={() => selection.setSelecting(false)}>
            <XIcon />
            Fine
          </Button>
          <BulkEditDialog
            open={bulkOpen}
            onOpenChange={setBulkOpen}
            books={selectedBooks}
            topics={index.topics}
            allTags={allTags}
            onApplied={() => {
              setBulkOpen(false);
              selection.setSelecting(false);
            }}
          />
        </>
      ) : (
        <>
          <Button variant="ghost" size="sm" onClick={() => selection.setSelecting(true)}>
            <CheckSquareIcon />
            Seleziona
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to={libraryPath("admin/topics")}>
              <FolderTreeIcon />
              Argomenti
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to={libraryPath("admin/upload")}>
              <PlusIcon />
              Aggiungi libro
            </Link>
          </Button>
        </>
      )}
    </div>
  );
}
