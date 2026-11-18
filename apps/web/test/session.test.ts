import { describe, expect, it, vi } from "vitest";
import {
  apiFetch,
  loadSession,
  loginUrl,
  sessionFromToken,
  takeTokenFromUrl,
  type StorageLike,
} from "../src/session";

function jwt(payload: object): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.signature`;
}
const NOW = Date.UTC(2026, 10, 18);
const soon = Math.floor(NOW / 1000) + 3600;

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("session token", () => {
  it("reads email and expiry; refuses expired or malformed tokens", () => {
    expect(sessionFromToken(jwt({ email: "me@example.com", exp: soon }), NOW)).toMatchObject({ email: "me@example.com", exp: soon });
    expect(sessionFromToken(jwt({ email: "me@example.com", exp: soon - 7200 }), NOW)).toBeNull();
    expect(sessionFromToken(jwt({ exp: soon }), NOW)).toBeNull();
    expect(sessionFromToken("not-a-token", NOW)).toBeNull();
  });

  it("takes the token from the URL fragment, stores it and returns the clean URL", () => {
    const storage = memory();
    const token = jwt({ email: "me@example.com", exp: soon });
    const clean = takeTokenFromUrl(`https://u.github.io/e-hub/library?x=1#token=${token}`, storage, NOW);
    expect(clean).toBe("/e-hub/library?x=1");
    expect(loadSession(storage, NOW)?.email).toBe("me@example.com");
    expect(takeTokenFromUrl("https://u.github.io/e-hub/", storage, NOW)).toBeNull();
  });

  it("does not store an expired token and drops one that expired in storage", () => {
    const storage = memory();
    const old = jwt({ email: "me@example.com", exp: soon - 7200 });
    takeTokenFromUrl(`https://u.github.io/#token=${old}`, storage, NOW);
    expect(storage.data.size).toBe(0);
    storage.setItem("ehub.session", old);
    expect(loadSession(storage, NOW)).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it("builds the login URL with an encoded return address", () => {
    expect(loginUrl("https://api.example.com", "https://u.github.io/e-hub/")).toBe(
      "https://api.example.com/auth/google?return=https%3A%2F%2Fu.github.io%2Fe-hub%2F",
    );
  });
});

describe("apiFetch", () => {
  it("sends API calls to the API origin with the token, and nothing else", async () => {
    const inner = vi.fn(async () => new Response("{}"));
    const f = apiFetch("https://api.example.com", () => "TOKEN", inner as unknown as typeof fetch);
    await f("/api/notes", { method: "POST" });
    const [url, init] = inner.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/api/notes");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer TOKEN");

    await f("https://other.example/api/x");
    expect(inner.mock.calls[1]![0]).toBe("https://other.example/api/x");
    expect(inner.mock.calls[1]![1]).toBeUndefined();
  });

  it("sends no Authorization header without a session, and reports a 401 once", async () => {
    const inner = vi.fn(async () => new Response("no", { status: 401 }));
    const unauthorized = vi.fn();
    const anonymous = apiFetch("", () => null, inner as unknown as typeof fetch, unauthorized);
    await anonymous("/api/notes");
    expect(new Headers((inner.mock.calls[0] as unknown as [string, RequestInit])[1].headers).has("authorization")).toBe(false);
    expect(unauthorized).not.toHaveBeenCalled();
    const signed = apiFetch("", () => "T", inner as unknown as typeof fetch, unauthorized);
    await signed("/api/notes");
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });
});
