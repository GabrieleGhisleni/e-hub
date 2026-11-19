/**
 * Admin bar above the library grid: add book (from an EPUB file or from Z-Library), topics, and selection mode with bulk edit.
 */
import {
  CheckSquareIcon,
  FolderTreeIcon,
  InfoIcon,
  FileUpIcon,
  LibraryBigIcon,
  PencilLineIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "@ehub/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ehub/ui/components/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@ehub/ui/components/popover";
import { useLibrarySelection } from "@library/selection";
import { BulkEditDialog } from "./bulk-edit-dialog";
import { KoboQueueStatus } from "./kobo-queue-status";
import { ZlibrarySearchSheet } from "./zlibrary-search-sheet";
import { collectTags } from "./lib/tags";
import { ADMIN_BUNDLE_MARKER } from "./marker";
import type { LibraryAdminBarProps } from "./types";
import { libraryPath } from "@library/lib/paths";

export function LibraryAdminBar({ index, visibleBooks }: LibraryAdminBarProps) {
  const selection = useLibrarySelection();
  const navigate = useNavigate();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [zlibraryOpen, setZlibraryOpen] = useState(false);
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
      className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm"
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="mr-auto inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand outline-none hover:border-brand/60 focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            Locale
            <InfoIcon aria-hidden className="size-3.5" />
            <span className="sr-only">: informazioni sulla modalità locale</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 text-sm">
          <p className="font-medium">Modalità locale</p>
          <p className="mt-1 text-muted-foreground">
            Le modifiche restano sul tuo computer: per pubblicare serve commit e push.
          </p>
        </PopoverContent>
      </Popover>
      <KoboQueueStatus />
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
            onDeleted={(remainingIds) => {
              if (remainingIds.length > 0) {
                selection.setSelected(remainingIds);
              } else {
                setBulkOpen(false);
                selection.setSelecting(false);
              }
            }}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <PlusIcon />
                Aggiungi libro
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => navigate(libraryPath("admin/upload"))}>
                <FileUpIcon />
                Da un file EPUB
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setZlibraryOpen(true)}>
                <LibraryBigIcon />
                Da Z-Library
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      {/* Outside the branch above: the sheet keeps its query and results when selection mode toggles. */}
      <ZlibrarySearchSheet open={zlibraryOpen} onOpenChange={setZlibraryOpen} />
    </div>
  );
}
