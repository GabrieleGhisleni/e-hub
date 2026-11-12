/**
 * Real check of the book chat against the configured router (EHUB_AI_* in the repo's .env.local).
 * Builds the chat app like apps/web/server/chat-dev.ts and asks one question about a book.
 * Usage: pnpm --filter @ehub/library exec tsx scripts/try-book-chat.ts [bookId] [question]
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createChatApp } from "@ehub/chat/server";
import { createLlm, loadAiConfig, loadDotEnvLocal } from "@ehub/chat/node";
import { createBookChatSource } from "../src/node/chat/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotEnvLocal(repoRoot);

const bookId = process.argv[2] ?? "stpgkrdt";
const question = process.argv[3] ?? "Cosa dice l'autore sul riposo? Cita un passaggio breve.";

const resolveBook = createBookChatSource();
const llm = createLlm(loadAiConfig());
const app = createChatApp({
  getLlm: () => llm,
  resolveSource: (source) =>
    source.kind === "book" ? resolveBook(source.id) : Promise.resolve(undefined),
});

const response = await app.request("/api/chat", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: `try-book-chat-${Date.now()}`,
    source: { kind: "book", id: bookId },
    messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: question }] }],
  }),
});
if (response.status !== 200) {
  console.error(`HTTP ${response.status}: ${await response.text()}`);
  process.exitCode = 1;
} else {
  const events = (await response.text())
    .split("\n\n")
    .map((event) => event.trim())
    .filter((event) => event.startsWith("data: ") && event !== "data: [DONE]")
    .map((event) => JSON.parse(event.slice("data: ".length)) as Record<string, any>);

  console.log(`Book: ${bookId}`);
  console.log(`Question: ${question}\n`);
  console.log("Tool calls:");
  for (const event of events.filter((e) => e.type === "tool-input-available")) {
    console.log(`- ${event.toolName} ${JSON.stringify(event.input)}`);
  }
  console.log("\nTool outputs (first 300 chars):");
  for (const event of events.filter((e) => e.type === "tool-output-available")) {
    console.log(`- ${String(event.output).slice(0, 300).replace(/\n/g, " | ")}`);
  }
  const text = events
    .filter((e) => e.type === "text-delta")
    .map((e) => e.delta as string)
    .join("");
  console.log(`\nFinal text:\n${text}`);
  const metadata = events.find((e) => e.type === "finish")?.messageMetadata;
  console.log(`\nMetadata: ${JSON.stringify(metadata)}`);
  const errors = events.filter((e) => e.type === "error");
  if (errors.length > 0) console.log(`Errors: ${JSON.stringify(errors)}`);
}
