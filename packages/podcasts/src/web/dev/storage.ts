/**
 * Small helpers over `sessionStorage` (editor drafts, flash messages).
 * Everything is wrapped in try/catch: storage can be missing or blocked, and
 * the UI must work without it.
 */
import { toast } from "sonner";

export function readJson<T>(key: string): T | undefined {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable or full: the draft just won't survive a reload.
  }
}

export function removeKey(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// --- Flash messages -------------------------------------------------------
// A write triggers a Vite full reload (the data files are imported by the
// app), which would swallow a toast. The message is stored first; if the page
// is still alive shortly after, it is shown straight away, otherwise the
// freshly loaded page shows it (`showPendingFlash`).

const FLASH_KEY = "e-podcasts-dev:flash";
const FLASH_MAX_AGE_MS = 15_000;
const FLASH_WAIT_MS = 1500;

type FlashKind = "success" | "info" | "warning" | "error";
interface Flash {
  kind: FlashKind;
  message: string;
  description?: string;
  at: number;
}

function show(flash: Flash) {
  const options = flash.description ? { description: flash.description } : undefined;
  toast[flash.kind](flash.message, { ...options, duration: 8000 });
}

export function flashAfterWrite(kind: FlashKind, message: string, description?: string): void {
  const flash: Flash = { kind, message, description, at: Date.now() };
  writeJson(FLASH_KEY, flash);
  window.setTimeout(() => {
    if (readJson<Flash>(FLASH_KEY)?.at === flash.at) {
      removeKey(FLASH_KEY);
      show(flash);
    }
  }, FLASH_WAIT_MS);
}

/** Called once when the page loads: shows a message left by the page that was just reloaded. */
export function showPendingFlash(): void {
  const flash = readJson<Flash>(FLASH_KEY);
  if (!flash) return;
  removeKey(FLASH_KEY);
  if (Date.now() - flash.at <= FLASH_MAX_AGE_MS) show(flash);
}
