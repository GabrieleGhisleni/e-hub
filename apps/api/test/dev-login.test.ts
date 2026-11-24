import { describe, expect, it } from "vitest";
import { MemoryDocClient } from "@ehub/store";
import { sessionVerifier } from "../src/auth.ts";
import { createDevLogin } from "../src/dev-login.ts";

const SECRET = "x".repeat(40);

async function setup() {
  const docs = new MemoryDocClient();
  await docs.users.upsert({ id: "u1", email: "me@example.com", name: "Me" });
  return createDevLogin({ docs, sessionSecret: SECRET, ownerEmail: "me@example.com" });
}

const post = (app: Awaited<ReturnType<typeof setup>>, headers: Record<string, string> = {}) =>
  app.request("http://127.0.0.1:5173/auth/dev", { method: "POST", headers: { host: "127.0.0.1:5173", ...headers } });

describe("POST /auth/dev", () => {
  it("gives the owner a session on loopback", async () => {
    const res = await post(await setup());
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect(await sessionVerifier(SECRET)(token)).toEqual({ userId: "u1", email: "me@example.com" });
  });

  it("refuses requests that came through a tunnel or a proxy, or addressed to another host", async () => {
    const app = await setup();
    expect((await post(app, { "x-forwarded-for": "1.2.3.4" })).status).toBe(403);
    expect((await post(app, { "cf-connecting-ip": "1.2.3.4" })).status).toBe(403);
    expect((await post(app, { host: "api.example.com" })).status).toBe(403);
  });

  it("answers 404 when the owner is not in the database yet", async () => {
    const app = createDevLogin({ docs: new MemoryDocClient(), sessionSecret: SECRET, ownerEmail: "me@example.com" });
    expect((await post(app)).status).toBe(404);
  });
});
