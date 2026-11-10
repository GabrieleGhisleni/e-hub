export type EpubErrorCode = "not-a-zip" | "missing-container" | "missing-opf" | "invalid-opf";

/** Thrown when the input is not a readable EPUB. Missing optional data is a warning, never an error. */
export class EpubError extends Error {
  readonly code: EpubErrorCode;

  constructor(code: EpubErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EpubError";
    this.code = code;
  }
}
