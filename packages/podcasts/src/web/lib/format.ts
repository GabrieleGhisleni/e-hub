/** Italian formatting helpers for dates, lists and counts. */

const LOCALE = "it-IT";

const calendarFormats = {
  short: new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }),
  long: new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }),
};

/** `YYYY-MM-DD` (a calendar date, no time zone) → "11 nov 2024" / "11 novembre 2024". */
export function formatCalendarDate(date: string, style: "short" | "long" = "short"): string {
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? date : calendarFormats[style].format(parsed);
}

const calendarMonth = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric", timeZone: "UTC" });

/** ISO publication month (YYYY-MM), independent of the viewer's time zone. */
export function formatPublicationMonth(month: string): string {
  return calendarMonth.format(new Date(`${month}-01T00:00:00Z`));
}

const instantFormats = {
  short: new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric" }),
  long: new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", year: "numeric" }),
  dateTime: new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }),
  month: new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric" }),
};

/** ISO datetime → date in the viewer's time zone. */
export function formatInstant(iso: string, style: keyof typeof instantFormats = "short"): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : instantFormats[style].format(parsed);
}

/**
 * Conversation dates: entered as `YYYY-MM-DD` they are stored at midnight UTC,
 * so those show as a calendar date; any other time shows date and time.
 */
export function formatConversationDate(iso: string): string {
  return /T00:00:00(\.0+)?Z$/.test(iso)
    ? formatCalendarDate(iso.slice(0, 10), "long")
    : formatInstant(iso, "dateTime");
}

/** ISO datetime → "Novembre 2026" (viewer's time zone). */
export function formatMonth(iso: string): string {
  const text = formatInstant(iso, "month");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Key grouping instants by month in the viewer's time zone, e.g. "2026-11". */
export function monthKey(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso.slice(0, 7);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
}

const listFormat = new Intl.ListFormat(LOCALE, { style: "long", type: "conjunction" });

/** ["A", "B", "C"] → "A, B e C". */
export function formatList(items: readonly string[]): string {
  return listFormat.format(items);
}

/** `plural(1, "episodio", "episodi")` → "1 episodio". */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
