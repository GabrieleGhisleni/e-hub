/**
 * Diagnostic: tries a few variants of the Z-Library search request against ONE mirror and prints status + start of the
 * response. The session key is read from the local cache and goes only to the mirror given as argument; it is never printed.
 *
 *   pnpm --filter @ehub/library exec tsx scripts/zlib-probe.ts https://z-lib.sk "stoici"
 */
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const bases = (process.argv[2] ?? "").split(",").map((b) => b.trim().replace(/\/+$/, ""));
const query = process.argv[3] ?? "stoici";
if (!bases.length || !bases.every((b) => /^https:\/\/[\w.-]+$/.test(b))) {
  console.error("uso: zlib-probe.ts https://<mirror>[,https://<altro>] [query]");
  process.exit(1);
}
const file = path.join(os.homedir(), ".cache/e-library/zlibrary-session.json");
const { userId, userKey } = JSON.parse(await readFile(file, "utf8")) as { userId: string; userKey: string };

const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36";
const cookie = `remix_userid=${userId}; remix_userkey=${userKey}`;
const keyHeaders = { "remix-userid": userId, "remix-userkey": userKey };
const form = (pairs: Array<[string, string]>) => new URLSearchParams(pairs).toString();
const full: Array<[string, string]> = [["message", query], ["page", "1"], ["limit", "30"], ["order", "popular"]];
const minimal: Array<[string, string]> = [["message", query], ["limit", "10"]];

const variantsFor = (base: string): Array<{ name: string; ua: string; headers: Record<string, string>; body: string }> => [
  { name: "A cookie+headers, full body (come l'app)", ua: DESKTOP, headers: { Cookie: cookie, ...keyHeaders }, body: form(full) },
  { name: "B solo header, body minimo", ua: ANDROID, headers: keyHeaders, body: form(minimal) },
  { name: "C solo cookie, body minimo", ua: ANDROID, headers: { Cookie: cookie }, body: form(minimal) },
  { name: "D cookie+header, UA android, body minimo", ua: ANDROID, headers: { Cookie: cookie, ...keyHeaders }, body: form(minimal) },
  { name: "E come D + Origin/Referer", ua: ANDROID, headers: { Cookie: cookie, ...keyHeaders, Origin: base, Referer: `${base}/` }, body: form(minimal) },
];

for (const base of bases) {
  const jar = new Map<string, string>();
  const v = variantsFor(base)[3]!;
  for (let hop = 0; hop < 4; hop++) {
    try {
      const jarCookie = [...jar].map(([k, val]) => `${k}=${val}`).join("; ");
      const res = await fetch(`${base}/eapi/book/search`, {
        method: "POST",
        redirect: "manual",
        headers: {
          "User-Agent": v.ua,
          "Content-Type": "application/x-www-form-urlencoded",
          ...v.headers,
          Cookie: [v.headers.Cookie, jarCookie].filter(Boolean).join("; "),
        },
        body: v.body,
        signal: AbortSignal.timeout(20_000),
      });
      const setNames = res.headers.getSetCookie().map((c) => c.split("=")[0]);
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(";");
        const i = pair!.indexOf("=");
        jar.set(pair!.slice(0, i), pair!.slice(i + 1));
      }
      const text = (await res.text()).replaceAll(userKey, "***").slice(0, 160).replace(/\s+/g, " ");
      console.log(`${base} hop${hop}: HTTP ${res.status} set-cookie=[${setNames.join(",")}] ${text}`);
      if (res.status < 300 || res.status >= 400) break;
    } catch (e) {
      console.log(`${base} hop${hop}: errore ${(e as Error).message}`);
      break;
    }
  }
  console.log();
}

// ---- web search page (what the browser does): GET /s/<query>
for (const base of bases) {
  const jar = new Map<string, string>();
  let url = `${base}/s/${encodeURIComponent(query)}`;
  for (let hop = 0; hop < 4; hop++) {
    try {
      const res = await fetch(url, {
        redirect: "manual",
        headers: {
          "User-Agent": DESKTOP,
          Accept: "text/html",
          Cookie: [cookie, ...[...jar].map(([k, v]) => `${k}=${v}`)].join("; "),
        },
        signal: AbortSignal.timeout(20_000),
      });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(";");
        const i = pair!.indexOf("=");
        jar.set(pair!.slice(0, i), pair!.slice(i + 1));
      }
      const html = await res.text();
      const loc = res.headers.get("location");
      console.log(
        `GET ${base}/s hop${hop}: HTTP ${res.status} location=${loc ?? "-"} bookcards=${(html.match(/z-bookcard/g) ?? []).length} title=${/<title>([^<]*)/i.exec(html)?.[1]?.slice(0, 60) ?? "-"}`,
      );
      if (res.status >= 300 && res.status < 400 && loc) {
        url = new URL(loc, url).toString();
        continue;
      }
      break;
    } catch (e) {
      console.log(`GET ${base}/s hop${hop}: errore ${(e as Error).message}`);
      break;
    }
  }
}
