import { describe, expect, it, vi } from "vitest";
import { fetchPending } from "../../src/web/admin/kobo-queue-status.tsx";

describe("fetchPending", () => {
  it("reads the number of waiting books; zero on any failure", async () => {
    const ok = vi.fn(async () => Response.json({ pending: ["a", "b"] }));
    expect(await fetchPending(ok as unknown as typeof fetch)).toBe(2);
    expect(await fetchPending((async () => new Response("no", { status: 500 })) as unknown as typeof fetch)).toBe(0);
    expect(await fetchPending((async () => Promise.reject(new Error("down"))) as unknown as typeof fetch)).toBe(0);
  });
});
