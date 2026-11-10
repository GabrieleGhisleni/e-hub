/** Admin actions on the book page: edit metadata, change cover, delete. */
import { ImageIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@ehub/ui/components/button";
import { ChangeCoverDialog } from "./change-cover-dialog";
import { DeleteBookDialog } from "./delete-book-dialog";
import { EditBookSheet } from "./edit-book-sheet";
import { ADMIN_BUNDLE_MARKER } from "./marker";
import type { BookAdminActionsProps } from "./types";

export function BookAdminActions({ book, index }: BookAdminActionsProps) {
  const [dialog, setDialog] = useState<"edit" | "cover" | "delete" | null>(null);
  const setOpen = (name: "edit" | "cover" | "delete") => (open: boolean) =>
    setDialog(open ? name : null);
  return (
    <div data-elib-admin={ADMIN_BUNDLE_MARKER} className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => setDialog("edit")}>
        <PencilIcon />
        Modifica
      </Button>
      <Button variant="outline" size="sm" onClick={() => setDialog("cover")}>
        <ImageIcon />
        Copertina
      </Button>
      <Button variant="destructive" size="sm" onClick={() => setDialog("delete")}>
        <Trash2Icon />
        Elimina
      </Button>
      <EditBookSheet
        book={book}
        index={index}
        open={dialog === "edit"}
        onOpenChange={setOpen("edit")}
      />
      <ChangeCoverDialog book={book} open={dialog === "cover"} onOpenChange={setOpen("cover")} />
      <DeleteBookDialog book={book} open={dialog === "delete"} onOpenChange={setOpen("delete")} />
    </div>
  );
}
