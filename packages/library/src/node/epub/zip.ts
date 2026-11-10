/**
 * Size-capped ZIP reading shared by the metadata extractor and the text module (R1-04).
 * `fflate.unzipSync` allocates the *declared* uncompressed size of every entry it inflates, so a tiny archive can ask
 * for gigabytes. Here the declared size (`originalSize`, read by the filter before any inflating) is checked first.
 */
import { unzipSync } from "fflate";

export const ZIP_LIMITS = {
  /** XML / XHTML / HTML / NCX / OPF / CSS / SVG / text entries. */
  maxTextEntryBytes: 16 * 1024 * 1024,
  /** Images and any other entry. */
  maxBinaryEntryBytes: 50 * 1024 * 1024,
  /** Sum of the declared sizes of all entries. */
  maxTotalBytes: 512 * 1024 * 1024,
  /** Most entries an archive may have. */
  maxEntries: 20_000,
  /** Sum of the bytes a reader inflates over its lifetime. */
  maxInflatedBytes: 256 * 1024 * 1024,
} as const;

export type ZipLimits = { -readonly [K in keyof typeof ZIP_LIMITS]: number };

/** The archive is not a readable ZIP, or it exceeds a size cap. `kind` tells which. */
export class ZipError extends Error {
  readonly kind: "not-a-zip" | "too-large";

  constructor(kind: "not-a-zip" | "too-large", message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ZipError";
    this.kind = kind;
  }
}

const TEXT_ENTRY = /\.(xml|xhtml|html?|ncx|opf|css|svg|txt|smil|xpgt|js)$/i;

export function entryLimit(name: string, limits: ZipLimits): number {
  return TEXT_ENTRY.test(name) ? limits.maxTextEntryBytes : limits.maxBinaryEntryBytes;
}

export interface CappedZip {
  /** Entry names as stored. */
  readonly names: string[];
  /** Inflates one entry (exact stored name); undefined when it cannot be inflated. */
  read(name: string): Uint8Array | undefined;
}

/**
 * Lists the archive without inflating anything, rejects it when an entry (or the total, or the entry count) is over
 * the caps, and returns a reader that inflates single entries on demand.
 */
export function openCappedZip(bytes: Uint8Array, overrides: Partial<ZipLimits> = {}): CappedZip {
  const limits: ZipLimits = { ...ZIP_LIMITS, ...overrides };
  const names: string[] = [];
  let total = 0;
  let tooLarge: string | undefined;
  try {
    unzipSync(bytes, {
      filter: (file) => {
        names.push(file.name);
        total += file.originalSize;
        if (!tooLarge && file.originalSize > entryLimit(file.name, limits)) {
          tooLarge = `entry "${file.name}" declares ${mb(file.originalSize)} uncompressed (limit ${mb(entryLimit(file.name, limits))})`;
        }
        return false;
      },
    });
  } catch (error) {
    throw new ZipError("not-a-zip", "The file is not a valid ZIP/EPUB archive.", {
      cause: error,
    });
  }
  if (names.length === 0) throw new ZipError("not-a-zip", "The archive is empty.");
  if (names.length > limits.maxEntries) {
    tooLarge = `${names.length} entries (limit ${limits.maxEntries})`;
  } else if (!tooLarge && total > limits.maxTotalBytes) {
    tooLarge = `${mb(total)} uncompressed in total (limit ${mb(limits.maxTotalBytes)})`;
  }
  if (tooLarge)
    throw new ZipError("too-large", `The archive is too large to read safely: ${tooLarge}.`);

  const stored = new Set(names);
  let inflated = 0;
  return {
    names,
    read(name) {
      if (!stored.has(name)) return undefined;
      let size = 0;
      try {
        const out = unzipSync(bytes, {
          filter: (f) => {
            if (f.name !== name) return false;
            size = f.originalSize;
            return true;
          },
        })[name];
        inflated += size;
        if (inflated > limits.maxInflatedBytes) {
          throw new ZipError("too-large", "The archive inflates to too much data.");
        }
        return out;
      } catch (error) {
        if (error instanceof ZipError) throw error;
        return undefined;
      }
    },
  };
}

function mb(n: number): string {
  return `${Math.round(n / (1024 * 1024))} MB`;
}
