import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app";
import { isLoopbackHost } from "../../src/server/security";

const app = createApp();
const ORIGIN = "http://localhost:5173";

function call(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  const { headers, ...rest } = init;
  return app.request(`http://localhost:5173${path}`, {
    ...rest,
    headers: { host: "localhost:5173", ...headers },
  });
}

const json = (extra: Record<string, string> = {}) => ({
  "content-type": "application/json",
  origin: ORIGIN,
  ...extra,
});

describe("isLoopbackHost", () => {
  it.each(["localhost", "localhost:5173", "127.0.0.1:8080", "[::1]:5173", "LOCALHOST:1"])(
    "accepts %s",
    (host) => expect(isLoopbackHost(host)).toBe(true),
  );
  it.each([
    undefined,
    "",
    "evil.example",
    "evil.example:5173",
    "localhost.evil.example",
    "localhost:5173.evil.example",
    "127.0.0.1.evil.example",
    "localhost@evil.example",
    "0.0.0.0:5173",
    "192.168.1.5:5173",
  ])("rejects %s", (host) => expect(isLoopbackHost(host)).toBe(false));
});

describe("host check", () => {
  it("allows loopback hosts", async () => {
    expect((await call("/api/podcasts/health")).status).toBe(200);
    expect((await call("/api/podcasts/health", { headers: { host: "127.0.0.1:5173" } })).status).toBe(200);
    expect((await call("/api/podcasts/health", { headers: { host: "[::1]:5173" } })).status).toBe(200);
  });

  it("rejects a foreign Host (DNS rebinding), also for GET", async () => {
    const res = await call("/api/podcasts/health", { headers: { host: "evil.example:5173" } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden-host" });
  });

  it("rejects a foreign Host on writes even with a matching Origin", async () => {
    const res = await call("/api/podcasts/episodes/preview", {
      method: "POST",
      headers: json({ host: "evil.example", origin: "http://evil.example" }),
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("write protection", () => {
  const body = JSON.stringify({ url: "not a url" });

  it("rejects a missing Origin", async () => {
    const res = await call("/api/podcasts/episodes/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden-origin" });
  });

  it("rejects a foreign Origin, including another localhost port", async () => {
    for (const origin of [
      "http://evil.example",
      "http://localhost:3000",
      "https://localhost:5173",
    ]) {
      const res = await call("/api/podcasts/episodes/preview", {
        method: "POST",
        headers: json({ origin }),
        body,
      });
      expect(res.status, origin).toBe(403);
    }
  });

  it("rejects non-JSON content types", async () => {
    for (const type of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "multipart/form-data",
      "",
    ]) {
      const res = await call("/api/podcasts/episodes/preview", {
        method: "POST",
        headers: { origin: ORIGIN, ...(type ? { "content-type": type } : {}) },
        body,
      });
      expect(res.status, type).toBe(415);
      expect(await res.json()).toMatchObject({ code: "unsupported-media-type" });
    }
  });

  it("covers PUT and DELETE as well", async () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const res = await call("/api/podcasts/episodes/some-episode", {
        method,
        headers: { "content-type": "text/plain", origin: "http://evil.example" },
        body: "{}",
      });
      expect([403, 415], method).toContain(res.status);
    }
  });

  it("lets a same-origin JSON write through to the handler", async () => {
    const res = await call("/api/podcasts/episodes/preview", { method: "POST", headers: json(), body });
    expect(res.status).toBe(422); // reached the handler: invalid URL
  });

  it("accepts a charset parameter and matches Origin to the Host that was used", async () => {
    const res = await call("/api/podcasts/episodes/preview", {
      method: "POST",
      headers: json({
        "content-type": "application/json; charset=utf-8",
        host: "127.0.0.1:5173",
        origin: "http://127.0.0.1:5173",
      }),
      body,
    });
    expect(res.status).toBe(422);
  });

  it("does not require Origin or JSON for reads", async () => {
    expect((await call("/api/podcasts/tags")).status).toBe(200);
  });
});
