// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HISTORY_LIMIT,
  HISTORY_MAX_CHARS,
  TITLE_MAX_CHARS,
  conversationTitle,
  deleteConversation,
  historyKey,
  loadConversations,
  relativeDate,
  saveConversation,
} from "../../src/web/history.ts";
import type { ChatSource, ChatUIMessage } from "../../src/shared/types.ts";

const source: ChatSource = { kind: "book", id: "eec5cpre" };

const exchange = (id: string, question: string, answer = "Risposta"): ChatUIMessage[] => [
  { id: `${id}-u`, role: "user", parts: [{ type: "text", text: question }] },
  {
    id: `${id}-a`,
    role: "assistant",
    parts: [{ type: "text", text: answer }],
    metadata: { model: "gemini-3.6-flash", provider: "google", tier: "smart", totalTokens: 900 },
  },
];

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 12, 10, minutes));

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("history storage", () => {
  it("saves a conversation under the source key and restores it with its messages", () => {
    const messages = exchange("c1", "Di cosa parla il libro?");
    saveConversation(source, { id: "c1", messages }, at(0));

    expect(window.localStorage.getItem(historyKey(source))).not.toBeNull();
    expect(historyKey(source)).toBe("ehub:chat:book:eec5cpre");

    const [restored] = loadConversations(source);
    expect(restored).toEqual({
      id: "c1",
      title: "Di cosa parla il libro?",
      updatedAt: at(0).toISOString(),
      messages,
    });
    // Metadata survives the round trip, so the reply keeps its model line.
    expect(restored?.messages[1]?.metadata?.model).toBe("gemini-3.6-flash");
  });

  it("keeps the histories of different sources apart", () => {
    saveConversation(source, { id: "c1", messages: exchange("c1", "Libro") }, at(0));
    expect(loadConversations({ kind: "episode", id: "eec5cpre" })).toEqual([]);
    expect(loadConversations(source)).toHaveLength(1);
  });

  it("does not save a conversation without messages", () => {
    saveConversation(source, { id: "c0", messages: [] }, at(0));
    expect(window.localStorage.getItem(historyKey(source))).toBeNull();
    expect(loadConversations(source)).toEqual([]);
  });

  it("lists the most recent conversation first and replaces one saved again under the same ID", () => {
    saveConversation(source, { id: "a", messages: exchange("a", "Prima") }, at(0));
    saveConversation(source, { id: "b", messages: exchange("b", "Seconda") }, at(1));
    saveConversation(source, { id: "a", messages: exchange("a", "Prima", "Nuova risposta") }, at(2));

    const list = loadConversations(source);
    expect(list.map((conversation) => conversation.id)).toEqual(["a", "b"]);
    expect(list[0]?.messages[1]?.parts[0]).toEqual({ type: "text", text: "Nuova risposta" });
    expect(list[0]?.updatedAt).toBe(at(2).toISOString());
  });

  it("keeps at most 10 conversations and drops the oldest", () => {
    for (let index = 0; index < HISTORY_LIMIT + 2; index += 1) {
      saveConversation(source, { id: `c${index}`, messages: exchange(`c${index}`, `Domanda ${index}`) }, at(index));
    }

    const list = loadConversations(source);
    expect(HISTORY_LIMIT).toBe(10);
    expect(list).toHaveLength(10);
    expect(list[0]?.id).toBe(`c${HISTORY_LIMIT + 1}`);
    expect(list.at(-1)?.id).toBe("c2");
    expect(list.some((conversation) => conversation.id === "c0")).toBe(false);
  });

  it("drops the oldest conversations when the JSON would exceed the size guard", () => {
    const big = "x".repeat(900_000);
    saveConversation(source, { id: "old", messages: exchange("old", "Vecchia", big) }, at(0));
    saveConversation(source, { id: "mid", messages: exchange("mid", "Media", big) }, at(1));
    saveConversation(source, { id: "new", messages: exchange("new", "Nuova", big) }, at(2));

    const raw = window.localStorage.getItem(historyKey(source)) ?? "";
    expect(raw.length).toBeLessThanOrEqual(HISTORY_MAX_CHARS);
    expect(loadConversations(source).map((conversation) => conversation.id)).toEqual(["new", "mid"]);
  });

  it("deletes one conversation and leaves the others", () => {
    saveConversation(source, { id: "a", messages: exchange("a", "Prima") }, at(0));
    saveConversation(source, { id: "b", messages: exchange("b", "Seconda") }, at(1));

    deleteConversation(source, "b");
    expect(loadConversations(source).map((conversation) => conversation.id)).toEqual(["a"]);
  });

  it("returns an empty list for corrupt or unexpected stored values", () => {
    window.localStorage.setItem(historyKey(source), "{not json");
    expect(loadConversations(source)).toEqual([]);

    window.localStorage.setItem(historyKey(source), JSON.stringify({ id: "x" }));
    expect(loadConversations(source)).toEqual([]);

    window.localStorage.setItem(historyKey(source), JSON.stringify([{ id: "x", title: 1 }]));
    expect(loadConversations(source)).toEqual([]);
  });

  it("does not throw when storage refuses reads and writes", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(loadConversations(source)).toEqual([]);
    expect(() => saveConversation(source, { id: "a", messages: exchange("a", "Prima") }, at(0))).not.toThrow();
    expect(() => deleteConversation(source, "a")).not.toThrow();
  });

  it("drops the oldest conversations when the browser refuses a write for quota", () => {
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      // Accept at most one conversation's worth of JSON.
      if (value.length > 5_000) throw new DOMException("full", "QuotaExceededError");
      return original.call(this, key, value);
    });

    saveConversation(source, { id: "a", messages: exchange("a", "Prima", "x".repeat(3_000)) }, at(0));
    saveConversation(source, { id: "b", messages: exchange("b", "Seconda", "x".repeat(3_000)) }, at(1));

    expect(loadConversations(source).map((conversation) => conversation.id)).toEqual(["b"]);
  });
});

describe("conversationTitle", () => {
  it("uses the first user question on one line", () => {
    expect(conversationTitle(exchange("c", "Quali  capitoli\nleggere?"))).toBe("Quali capitoli leggere?");
  });

  it("shortens long questions to at most 80 characters", () => {
    const title = conversationTitle(exchange("c", "parola ".repeat(40)));
    expect(Array.from(title)).toHaveLength(TITLE_MAX_CHARS);
    expect(title.endsWith("…")).toBe(true);
  });

  it("falls back to a generic title without a user question", () => {
    expect(conversationTitle([])).toBe("Conversazione");
  });
});

describe("relativeDate", () => {
  const now = new Date(Date.UTC(2026, 10, 12, 12, 0));

  it("describes the age of a conversation in Italian", () => {
    expect(relativeDate(new Date(now.getTime() - 20_000).toISOString(), now)).toBe("adesso");
    expect(relativeDate(new Date(now.getTime() - 5 * 60_000).toISOString(), now)).toBe("5 minuti fa");
    expect(relativeDate(new Date(now.getTime() - 3 * 3_600_000).toISOString(), now)).toBe("3 ore fa");
    expect(relativeDate(new Date(now.getTime() - 26 * 3_600_000).toISOString(), now)).toBe("ieri");
    expect(relativeDate(new Date(now.getTime() - 3 * 86_400_000).toISOString(), now)).toBe("3 giorni fa");
  });

  it("shows a date for older conversations and nothing for invalid ones", () => {
    const old = relativeDate(new Date(now.getTime() - 30 * 86_400_000).toISOString(), now);
    expect(old).toMatch(/\d/);
    expect(relativeDate("non una data", now)).toBe("");
  });
});
