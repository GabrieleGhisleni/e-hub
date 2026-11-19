import { ImageIcon, PencilIcon, SettingsIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@ehub/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ehub/ui/components/dropdown-menu";
import { BookChat } from "./book-chat";
import { ChangeCoverDialog } from "./change-cover-dialog";
import { DeleteBookDialog } from "./delete-book-dialog";
import { EditBookSheet } from "./edit-book-sheet";
import { SummarizeBookDialog } from "./summarize-book-dialog";
import { ADMIN_BUNDLE_MARKER } from "./marker";
import type { BookAdminActionsProps } from "./types";
import { BookCover } from "@library/components/book-cover";

export function BookAdminActions({ book, index, placement }: BookAdminActionsProps) {
  const [dialog, setDialog] = useState<"edit" | "cover" | "summary" | "delete" | null>(null);
  const setOpen = (name: NonNullable<typeof dialog>) => (open: boolean) =>
    setDialog(open ? name : null);
  const summaryLabel = book.summary ? "Rigenera sintesi" : "Genera sintesi";

  if (placement === "cover") {
    return (
      <>
        <button
          type="button"
          aria-label="Cambia copertina"
          className="group/cover relative block w-full cursor-pointer self-start rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring"
          onClick={() => setDialog("cover")}
        >
          <BookCover key={book.coverUrl} book={book} eager>
            <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-black/75 px-2 py-2 text-sm font-medium text-white transition-opacity [@media(hover:hover)]:opacity-0 group-hover/cover:opacity-100 group-focus-visible/cover:opacity-100">
              <ImageIcon aria-hidden className="size-4" />
              Cambia copertina
            </span>
          </BookCover>
        </button>
        <ChangeCoverDialog book={book} open={dialog === "cover"} onOpenChange={setOpen("cover")} />
      </>
    );
  }

  if (placement === "summary") {
    return (
      <>
        <Button variant="outline" size="sm" onClick={() => setDialog("summary")}>
          <SparklesIcon aria-hidden />
          {summaryLabel}
        </Button>
        <SummarizeBookDialog
          book={book}
          open={dialog === "summary"}
          onOpenChange={setOpen("summary")}
        />
      </>
    );
  }

  return (
    <div data-elib-admin={ADMIN_BUNDLE_MARKER} className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        aria-label="Modifica libro"
        title="Modifica libro"
        onClick={() => setDialog("edit")}
      >
        <PencilIcon aria-hidden />
      </Button>
      <BookChat book={book} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label="Opzioni del libro"
            title="Opzioni del libro"
          >
            <SettingsIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog("cover")}>
            <ImageIcon aria-hidden />
            Cambia copertina
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("summary")}>
            <SparklesIcon aria-hidden />
            {summaryLabel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="outline"
        size="icon"
        aria-label="Elimina libro"
        title="Elimina libro"
        className="text-destructive hover:text-destructive"
        onClick={() => setDialog("delete")}
      >
        <Trash2Icon aria-hidden />
      </Button>
      <EditBookSheet
        book={book}
        index={index}
        open={dialog === "edit"}
        onOpenChange={setOpen("edit")}
      />
      <ChangeCoverDialog book={book} open={dialog === "cover"} onOpenChange={setOpen("cover")} />
      <SummarizeBookDialog
        book={book}
        open={dialog === "summary"}
        onOpenChange={setOpen("summary")}
      />
      <DeleteBookDialog book={book} open={dialog === "delete"} onOpenChange={setOpen("delete")} />
    </div>
  );
}
