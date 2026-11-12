/** "Chatta" on a book page (dev only: rendered from the admin actions). */
import { ChatButton } from "@ehub/chat/web";
import type { BookDetail } from "@shared/schema";

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

export function BookChat({ book }: { book: BookDetail }) {
  return (
    <ChatButton
      source={{ kind: "book", id: book.id }}
      title={book.title}
      subtitle={book.authors.join(", ")}
      suggestions={bookChatSuggestions(book)}
      notice={book.summary === null ? NO_SUMMARY_NOTICE : undefined}
    />
  );
}
