/** Book summary (docs/chat.md §4) in the admin UI: language choices, error texts, success text. Pure, unit-tested. */
import type { SummarizeResponse } from "../../../shared/api.ts";
import { friendlyMessage, ApiRequestError } from "./errors.ts";

export interface LanguageOption {
  value: string;
  label: string;
}

/** Italiano (default) and English, plus the book's own language when it is neither of those. */
export function summaryLanguageOptions(bookLanguage: string | undefined): LanguageOption[] {
  const options: LanguageOption[] = [
    { value: "it", label: "Italiano" },
    { value: "en", label: "Inglese" },
  ];
  const tag = bookLanguage?.trim() ?? "";
  if (tag.length < 2 || tag.length > 10) return options;
  const primary = tag.toLowerCase().split("-")[0];
  if (primary === "it" || primary === "en") return options;
  return [...options, { value: tag, label: languageLabel(tag) }];
}

/** Italian name of a BCP 47 tag, falling back to the tag itself. */
function languageLabel(tag: string): string {
  try {
    const names = new Intl.DisplayNames(["it"], { type: "language" });
    const name = names.of(tag);
    return name && name.toLowerCase() !== tag.toLowerCase()
      ? name.charAt(0).toLocaleUpperCase("it-IT") + name.slice(1)
      : tag;
  } catch {
    return tag;
  }
}

export interface SummaryFailure {
  message: string;
  hint: string | null;
}

/** What the dialog shows for a failed run. The server message is Italian already. */
export function summaryFailure(error: unknown): SummaryFailure {
  const hint =
    error instanceof ApiRequestError && error.code === "ai-not-configured"
      ? "Configura EHUB_AI_* in .env.local."
      : null;
  return { message: friendlyMessage(error), hint };
}

/** "Sintesi generata: 12 capitoli in 95s". */
export function summaryDoneText(response: SummarizeResponse): string {
  const chapters = response.summarizedChapters;
  const seconds = Math.round(response.durationMs / 1000);
  return `Sintesi generata: ${chapters} ${chapters === 1 ? "capitolo" : "capitoli"} in ${seconds}s`;
}
