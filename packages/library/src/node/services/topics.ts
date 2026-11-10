/**
 * Topics management (PLAN §5 "Classificazione", §7.6): add, rename (Drive folders renamed, books unchanged), delete
 * (books reassigned to `unsorted`, then reconciled), usage counts for the confirmation dialogs.
 */
import {
  type DeleteTopicResponse,
  type TopicWriteResponse,
  type TopicsResponse,
  emptyReconcileReport,
} from "../../shared/api.ts";
import { topicIdFromLabel } from "../../shared/ids.ts";
import { UNSORTED_TOPIC_ID } from "../../shared/labels.ts";
import { TopicIdSchema, type Topic } from "../../shared/schema.ts";
import { reconcile, renameTopicFolders } from "../drive/index.ts";
import { InvalidDataError, readAllBooks, writeBook, writeTopics } from "../repo/index.ts";
import type { ServiceContext } from "./context.ts";
import { badRequest, conflict, notFound } from "./errors.ts";
import { asWriteError, loadTopics } from "./internal.ts";

/** topics.json in its order, each with the number of (valid) books that use it. */
export async function listTopics(ctx: ServiceContext): Promise<TopicsResponse> {
  const topics = await loadTopics(ctx);
  const { books } = await readAllBooks(ctx.dataDir);
  const counts = new Map<string, number>();
  for (const book of books) counts.set(book.topic, (counts.get(book.topic) ?? 0) + 1);
  return { topics: topics.map((t) => ({ ...t, bookCount: counts.get(t.id) ?? 0 })) };
}

/** Collapses whitespace; 400 when nothing is left. */
function cleanLabel(label: string): string {
  const clean = label.replace(/\s+/g, " ").trim();
  if (!clean) throw badRequest("invalid-request", "L'etichetta dell'argomento è vuota.");
  return clean;
}

async function saveTopics(ctx: ServiceContext, topics: Topic[], label: string): Promise<void> {
  try {
    await writeTopics(ctx.dataDir, topics);
  } catch (error) {
    if (error instanceof InvalidDataError) {
      throw conflict(
        "topic-conflict",
        `"${label}" finirebbe nella stessa cartella di Drive di un altro argomento (le maiuscole non contano).`,
        { issues: error.issues },
      );
    }
    throw asWriteError(error);
  }
}

/** New topic: its ID comes from the label (`topicIdFromLabel`) and never changes. No Drive change. */
export async function addTopic(ctx: ServiceContext, label: string): Promise<TopicWriteResponse> {
  const clean = cleanLabel(label);
  return ctx.lock.runExclusive(async () => {
    const topics = await loadTopics(ctx);
    const topic: Topic = {
      id: topicIdFromLabel(
        clean,
        topics.map((t) => t.id),
      ),
      label: clean,
    };
    const next = [...topics, topic];
    await saveTopics(ctx, next, clean);
    return { topic, topics: next, report: emptyReconcileReport() };
  });
}

function findTopic(topics: readonly Topic[], id: string): Topic {
  if (!TopicIdSchema.safeParse(id).success) {
    throw badRequest("invalid-request", `ID argomento non valido: ${JSON.stringify(id)}`);
  }
  const topic = topics.find((t) => t.id === id);
  if (!topic) throw notFound("topic-not-found", `L'argomento "${id}" non esiste.`);
  return topic;
}

/** New label in topics.json (books keep the ID), then the topic folders are renamed on Drive. */
export async function renameTopic(
  ctx: ServiceContext,
  id: string,
  label: string,
): Promise<TopicWriteResponse> {
  const clean = cleanLabel(label);
  return ctx.lock.runExclusive(async () => {
    const topics = await loadTopics(ctx);
    const old = findTopic(topics, id);
    if (old.label === clean) return { topic: old, topics, report: emptyReconcileReport() };
    const topic: Topic = { ...old, label: clean };
    const next = topics.map((t) => (t.id === id ? topic : t));
    await saveTopics(ctx, next, clean);
    const report = await renameTopicFolders(ctx.drive, old.label, clean);
    return { topic, topics: next, report };
  });
}

/**
 * Deletes a topic: its books are reassigned to `unsorted` first (each book.json rewritten), then topics.json, then one
 * reconcile moves their files into the "Da smistare" folders. `unsorted` cannot be deleted.
 */
export async function deleteTopic(ctx: ServiceContext, id: string): Promise<DeleteTopicResponse> {
  if (id === UNSORTED_TOPIC_ID) {
    throw badRequest("topic-protected", 'L\'argomento "Da smistare" non si può eliminare.');
  }
  return ctx.lock.runExclusive(async () => {
    const topics = await loadTopics(ctx);
    findTopic(topics, id);
    const books = (await readAllBooks(ctx.dataDir)).books.filter((b) => b.topic === id);
    for (const book of books) {
      try {
        await writeBook(ctx.dataDir, { ...book, topic: UNSORTED_TOPIC_ID });
      } catch (error) {
        throw asWriteError(error);
      }
    }
    const next = topics.filter((t) => t.id !== id);
    await saveTopics(ctx, next, id);
    const report =
      books.length > 0
        ? await reconcile(
            ctx.drive,
            books.map((b) => b.id),
          )
        : emptyReconcileReport();
    return { id, reassigned: books.length, topics: next, report };
  });
}
