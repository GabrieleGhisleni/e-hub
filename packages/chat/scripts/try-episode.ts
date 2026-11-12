// End-to-end check of the episode chat against the REAL router configured in .env.local.
// Builds the app the same way apps/web/server/chat-dev.ts does, sends one question about an episode
// through app.request(), and prints the streamed reply and the message metadata.
// Run with: pnpm --filter @ehub/chat exec tsx scripts/try-episode.ts

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createChatApp, type ChatSourceContext } from "../src/server/app.ts";
import { createLlm, loadAiConfig, loadDotEnvLocal, type Llm } from "../src/node/index.ts";
// @ehub/chat has no dependency on @ehub/podcasts, so the podcasts module is imported by path.
import { buildEpisodeChatContext, NotFoundError, ValidationError } from "../../podcasts/src/core/chat-context.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotEnvLocal(repoRoot);

const EPISODE = "lex-fridman-503-ai-crisis-in-math-navier-stokes-riemann-hypothesis-complexity";
const QUESTION =
  "Di cosa discutono gli ospiti sull'uso dell'AI nella matematica? Cita un momento preciso della trascrizione.";

let llm: Llm | undefined;
const app = createChatApp({
  getLlm: () => {
    llm ??= createLlm(loadAiConfig());
    return llm;
  },
  resolveSource: async (source): Promise<ChatSourceContext | undefined> => {
    if (source.kind !== "episode") return undefined;
    try {
      const context = await buildEpisodeChatContext(source.id);
      return { system: context.system, tokens: context.tokens };
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ValidationError) return undefined;
      throw error;
    }
  },
});

const id = `try-episode-${Date.now()}`;
console.log(`Episode ${EPISODE}`);
console.log(`Conversation ${id}`);
console.log(`Question: ${QUESTION}\n`);

const started = Date.now();
const response = await app.request("/api/chat", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id,
    source: { kind: "episode", id: EPISODE },
    messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: QUESTION }] }],
  }),
});

console.log(`HTTP ${response.status} ${response.headers.get("content-type")}`);
if (!response.ok) {
  console.log(await response.text());
  process.exit(1);
}

// Each SSE event is `data: <json>`; the UI stream ends with `data: [DONE]`.
const raw = await response.text();
const chunks = raw
  .split("\n\n")
  .map((event) => event.trim())
  .filter((event) => event.startsWith("data: ") && event !== "data: [DONE]")
  .map((event) => JSON.parse(event.slice("data: ".length)));

const text = chunks
  .filter((chunk) => chunk.type === "text-delta")
  .map((chunk) => chunk.delta)
  .join("");
const metadata = chunks.map((chunk) => chunk.messageMetadata).filter(Boolean);
const errors = chunks.filter((chunk) => chunk.type === "error");

console.log("--- reply ---");
console.log(text);
console.log("--- metadata ---");
console.log(JSON.stringify(metadata.at(-1) ?? null, null, 2));
if (errors.length > 0) console.log("stream errors:", JSON.stringify(errors));
console.log(`--- ${chunks.length} chunks in ${((Date.now() - started) / 1000).toFixed(1)} s ---`);
