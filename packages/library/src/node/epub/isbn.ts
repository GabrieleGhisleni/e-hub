function isbn10Valid(d: string): boolean {
  if (!/^\d{9}[\dXx]$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = d[i]!;
    const v = ch === "X" || ch === "x" ? 10 : Number(ch);
    sum += v * (10 - i);
  }
  return sum % 11 === 0;
}

function isbn13Check(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

function isbn13Valid(d: string): boolean {
  return /^97[89]\d{10}$/.test(d) && isbn13Check(d) === Number(d[12]);
}

/** Returns ISBN-13 digits for a valid ISBN-10/13 (hyphens, spaces and `urn:isbn:` allowed), else null. */
export function normalizeIsbn(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^(urn:)?isbn:?\s*/i, "")
    .replace(/[\s-]/g, "");
  if (isbn13Valid(cleaned)) return cleaned;
  if (isbn10Valid(cleaned)) {
    const core = `978${cleaned.slice(0, 9)}`;
    return `${core}${isbn13Check(core)}`;
  }
  return null;
}
