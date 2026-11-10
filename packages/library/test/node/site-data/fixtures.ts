import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface FakeBook {
  id: string;
  title?: string;
  authors?: string[];
  topic?: string;
  [key: string]: unknown;
}

/** Writes data/books/<id>/book.json (+ extra files) into a temp data dir. */
export async function writeFakeBook(
  dataDir: string,
  book: FakeBook,
  files: Record<string, string | Buffer> = {},
): Promise<void> {
  const dir = path.join(dataDir, "books", book.id);
  await mkdir(dir, { recursive: true });
  const full = {
    title: `Titolo ${book.id}`,
    authors: ["Mario Rossi"],
    topic: "narrativa",
    status: "to-read",
    ...book,
  };
  await writeFile(path.join(dir, "book.json"), `${JSON.stringify(full, null, 2)}\n`);
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dir, name), content);
  }
}
