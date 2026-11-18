import { describe, expect, it, vi } from "vitest";
import {
  apiFetch,
  loadSession,
  sessionFromToken,
  storeToken,
  exchangeCredential,
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

  it("stores a valid token and refuses an expired or malformed one", () => {
    const storage = memory();
    expect(storeToken(storage, jwt({ email: "me@example.com", exp: soon }), NOW)).toBe(true);
    expect(loadSession(storage, NOW)?.email).toBe("me@example.com");
    const other = memory();
    expect(storeToken(other, jwt({ email: "me@example.com", exp: soon - 7200 }), NOW)).toBe(false);
    expect(storeToken(other, "junk", NOW)).toBe(false);
    expect(other.data.size).toBe(0);
  });

  it("drops an expired token found in storage", () => {
    const storage = memory();
    storage.setItem("ehub.session", jwt({ email: "me@example.com", exp: soon - 7200 }));
    expect(loadSession(storage, NOW)).toBeNull();
    expect(storage.data.size).toBe(0);
  });
});

describe("exchangeCredential", () => {
  it("posts the Google ID token to the API and returns its session token", async () => {
    const fetchMock = vi.fn(async () => Response.json({ token: "SESSION" }));
    expect(await exchangeCredential("https://api.example.com", "GOOGLE", fetchMock as unknown as typeof fetch)).toBe("SESSION");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/auth/google");
    expect(JSON.parse(init.body as string)).toEqual({ credential: "GOOGLE" });
  });

  it("explains a refused account and any other failure", async () => {
    const make = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;
    await expect(exchangeCredential("", "x", make(403))).rejects.toThrow("non è autorizzato");
    await expect(exchangeCredential("", "x", make(500))).rejects.toThrow("Accesso non riuscito");
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
