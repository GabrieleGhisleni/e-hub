import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZlibraryClient } from "../../../src/node/zlibrary/index.ts";

describe("Z-Library per-user session", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "zlib-session-"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ response: { id: 7, remix_userkey: "KEY" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  it("connect keeps the session key, never the password, and a new client restores it", async () => {
    const client = new ZlibraryClient({ baseUrl: "https://z.example" }, dir);
    expect(client.configured).toBe(false);
    await client.connect("me@example.com", "segreto");
    expect(client.configured).toBe(true);
    expect(client.accountEmail).toBe("me@example.com");

    const file = await readFile(path.join(dir, "zlibrary-session.json"), "utf8");
    expect(file).not.toContain("segreto");
    expect(JSON.parse(file)).toMatchObject({ userId: "7", userKey: "KEY", email: "me@example.com" });

    const next = new ZlibraryClient({ baseUrl: "https://z.example" }, dir);
    expect(next.configured).toBe(false);
    await next.restore();
    expect(next.configured).toBe(true);
    expect(next.accountEmail).toBe("me@example.com");

    const other = new ZlibraryClient({ baseUrl: "https://z.example" }, path.join(dir, "users", "b"));
    await other.restore();
    expect(other.configured).toBe(false);

    await next.disconnect();
    const after = new ZlibraryClient({ baseUrl: "https://z.example" }, dir);
    await after.restore();
    expect(after.configured).toBe(false);
  });
});
