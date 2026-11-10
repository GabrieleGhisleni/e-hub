import { z } from "zod";

/** A data file exists but does not parse or does not match the schema. */
export class InvalidDataError extends Error {
  readonly file: string;
  readonly issues: z.core.$ZodIssue[];
  constructor(file: string, message: string, issues: z.core.$ZodIssue[] = [], cause?: unknown) {
    super(`${file}: ${message}`, { cause });
    this.name = "InvalidDataError";
    this.file = file;
    this.issues = issues;
  }

  static fromZod(file: string, error: z.ZodError): InvalidDataError {
    return new InvalidDataError(file, z.prettifyError(error), error.issues, error);
  }
}

/** No `book.json` for this ID (the folder may be missing or be an incomplete upload). */
export class BookNotFoundError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`book ${id} not found`);
    this.name = "BookNotFoundError";
    this.id = id;
  }
}
