/** "Chatta" on a book page (dev only: rendered from the admin actions). */
import { ChatButton, chatNoteBody } from "@ehub/chat/web";
import { type NoteItemRef, notesStore } from "@ehub/notes";
import type { BookDetail } from "@shared/schema";
import { toast } from "sonner";
import { bookHref, formatAuthors } from "@library/lib/format";
import { libraryPath } from "@library/lib/paths";

export const NO_SUMMARY_NOTICE =
  "Senza sintesi la chat legge i capitoli direttamente: più lenta. Genera la sintesi per risposte migliori.";

/** Suggestions in Italian. The second one names the first tag (or subject) of the book when there is one. */
export function bookChatSuggestions(book: Pick<BookDetail, "tags" | "subjects">): string[] {
  const topic = book.tags[0] ?? book.subjects?.[0];
  return [
    "Di cosa parla il libro, in breve?",
    topic
      ? `Quali capitoli dovrei leggere se mi interessa ${topic}?`
      : "Quali capitoli dovrei leggere se mi interessa un tema del libro?",
    "Qual è la tesi più discutibile?",
  ];
}

/** The note item for this book, the same shape the book page builds for its notes. */
export function bookNoteItem(book: Pick<BookDetail, "id" | "slug" | "title" | "authors">): NoteItemRef {
  return {
    module: "library",
    id: book.id,
    title: book.title,
    subtitle: formatAuthors(book.authors),
    href: libraryPath(bookHref(book)),
  };
}

export function BookChat({ book }: { book: BookDetail }) {
  return (
    <ChatButton
      source={{ kind: "book", id: book.id }}
      title={book.title}
      subtitle={book.authors.join(", ")}
      suggestions={bookChatSuggestions(book)}
      notice={book.summary === null ? NO_SUMMARY_NOTICE : undefined}
      onSaveNote={(note) => {
        notesStore.add(bookNoteItem(book), chatNoteBody(note));
        toast.success("Nota salvata");
      }}
    />
  );
}
