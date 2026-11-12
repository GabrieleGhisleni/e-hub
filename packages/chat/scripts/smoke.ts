// Smoke test against the REAL endpoint configured in .env.local (or the environment).
// Steps: plain generation, streaming, and a tool call through runAgent. Exit 1 on any failure.
// Run with: pnpm --filter @ehub/chat smoke

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateText, streamText } from "ai";
import { z } from "zod";
import { createLlm, defineTool, loadAiConfig, loadDotEnvLocal, runAgent } from "../src/node/index.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotEnvLocal(repoRoot);

let failures = 0;

async function step(name: string, run: () => Promise<string>): Promise<void> {
  try {
    const detail = await run();
    console.log(`PASS ${name}${detail ? `: ${detail}` : ""}`);
  } catch (error) {
    failures++;
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const config = loadAiConfig();
const { chatModel } = createLlm(config);
console.log(`Endpoint ${config.baseUrl}, model ${config.model}`);

await step("(a) generateText", async () => {
  const result = await generateText({ model: chatModel, prompt: "Rispondi solo: ok" });
  if (!result.text.trim()) throw new Error("empty reply");
  return JSON.stringify(result.text.trim().slice(0, 80));
});

await step("(b) streamText", async () => {
  const result = streamText({ model: chatModel, prompt: "Conta da 1 a 3, solo numeri." });
  let chars = 0;
  for await (const delta of result.textStream) {
    process.stdout.write(delta);
    chars += delta.length;
  }
  process.stdout.write("\n");
  if (chars === 0) throw new Error("no deltas received");
  return `${chars} characters`;
});

await step("(c) runAgent with get_time tool", async () => {
  let calls = 0;
  const result = runAgent({
    model: chatModel,
    system: "Usa sempre lo strumento get_time quando ti chiedono l'ora.",
    messages: [{ role: "user", content: "Che ore sono a Roma? Usa lo strumento get_time." }],
    maxSteps: 4,
    tools: {
      get_time: defineTool({
        description: "Returns the current time in an IANA timezone.",
        inputSchema: z.object({ timezone: z.string() }),
        execute: async ({ timezone }) => {
          calls++;
          return new Date().toLocaleString("it-IT", { timeZone: timezone });
        },
      }),
    },
  });
  const text = await result.text;
  if (calls === 0) throw new Error("get_time was not called");
  return `tool called ${calls}x, reply ${JSON.stringify(text.slice(0, 80))}`;
});

if (failures > 0) {
  console.log(`${failures} step(s) failed`);
  process.exit(1);
}
console.log("All steps passed");
