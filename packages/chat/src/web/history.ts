/**
 * Conversation history in localStorage: one list per source, under `ehub:chat:<kind>:<id>`.
 * The list is most recent first and holds at most `HISTORY_LIMIT` conversations.
 * Every storage access is guarded: without storage the chat simply has no history.
 */
import type { ChatSource, ChatUIMessage } from "../shared/types";

export const HISTORY_LIMIT = 10;
/** Upper bound for the JSON of one source's list (characters, about 2 MB in UTF-16 storage). */
export const HISTORY_MAX_CHARS = 2 * 1024 * 1024;
export const TITLE_MAX_CHARS = 80;

export type StoredConversation = {
  /** Conversation ID chosen by the chat panel (the same one sent to the server). */
  id: string;
  /** First user question, one line, at most `TITLE_MAX_CHARS` characters. */
  title: string;
  /** ISO instant of the last saved reply. */
  updatedAt: string;
  messages: ChatUIMessage[];
};

export function historyKey(source: ChatSource): string {
  return `ehub:chat:${source.kind}:${source.id}`;
}

/** First user question as a one-line title. */
export function conversationTitle(messages: readonly ChatUIMessage[]): string {
  const first = messages.find((message) => message.role === "user");
  const text = first
    ? first.parts.map((part) => (part.type === "text" ? part.text : "")).join("")
    : "";
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine === "") return "Conversazione";
  const characters = Array.from(oneLine);
  if (characters.length <= TITLE_MAX_CHARS) return oneLine;
  return `${characters.slice(0, TITLE_MAX_CHARS - 1).join("").trimEnd()}…`;
}

function isStoredConversation(value: unknown): value is StoredConversation {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<Record<keyof StoredConversation, unknown>>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.updatedAt === "string" &&
    Array.isArray(candidate.messages) &&
    candidate.messages.every(
      (message) =>
        message !== null &&
        typeof message === "object" &&
        typeof (message as { id?: unknown }).id === "string" &&
        Array.isArray((message as { parts?: unknown }).parts),
    )
  );
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeRaw(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable: nothing to remove.
  }
}

/**
 * Drops the oldest conversations until the JSON fits in `maxChars`.
 * The list is most recent first, so the oldest are at the end.
 */
export function fitToSize(
  conversations: readonly StoredConversation[],
  maxChars = HISTORY_MAX_CHARS,
): StoredConversation[] {
  let next = [...conversations];
  while (next.length > 0 && JSON.stringify(next).length > maxChars) {
    next = next.slice(0, -1);
  }
  return next;
}

/** Stored conversations for a source, most recent first. Empty when storage is unavailable or corrupt. */
export function loadConversations(source: ChatSource): StoredConversation[] {
  const raw = readRaw(historyKey(source));
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredConversation).slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function persist(key: string, conversations: StoredConversation[]): StoredConversation[] {
  let next = fitToSize(conversations);
  while (next.length > 0) {
    if (writeRaw(key, JSON.stringify(next))) return next;
    // The browser refused the write (quota): drop the oldest and try again.
    next = next.slice(0, -1);
  }
  removeRaw(key);
  return [];
}

/**
 * Saves a conversation at the top of the source's list (replacing one with the same ID).
 * Conversations without messages are not saved. Returns the list as stored.
 */
export function saveConversation(
  source: ChatSource,
  conversation: { id: string; messages: ChatUIMessage[] },
  now: Date = new Date(),
): StoredConversation[] {
  const key = historyKey(source);
  const existing = loadConversations(source);
  if (conversation.messages.length === 0) return existing;
  const entry: StoredConversation = {
    id: conversation.id,
    title: conversationTitle(conversation.messages),
    updatedAt: now.toISOString(),
    messages: conversation.messages,
  };
  const others = existing.filter((item) => item.id !== conversation.id);
  return persist(key, [entry, ...others].slice(0, HISTORY_LIMIT));
}

/** Removes one conversation from the source's list. Returns the list as stored. */
export function deleteConversation(source: ChatSource, id: string): StoredConversation[] {
  const remaining = loadConversations(source).filter((item) => item.id !== id);
  return persist(historyKey(source), remaining);
}

const RELATIVE = new Intl.RelativeTimeFormat("it", { numeric: "auto" });

/** "adesso", "5 min fa", "ieri", "12 nov": how long ago a saved conversation was updated. */
export function relativeDate(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const time = then.getTime();
  if (Number.isNaN(time)) return "";
  const minutes = Math.round((time - now.getTime()) / 60_000);
  if (Math.abs(minutes) < 1) return "adesso";
  if (Math.abs(minutes) < 60) return RELATIVE.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return RELATIVE.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return RELATIVE.format(days, "day");
  return then.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}
