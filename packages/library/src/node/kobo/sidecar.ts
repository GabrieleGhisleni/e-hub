/**
 * The KOReader sidecar metadata written next to each KEPUB (docs/kobo-ssh-migration.md, "Organizzazione per argomento").
 * `<name>.kepub.sdr/custom_metadata.lua` is what KOReader reads for the series (`custom_props.series`, the topic label)
 * and for the document properties. The format is the one the Python script used on the device wrote.
 */
import { KOBO_SIDECAR_METADATA_FILE, koboFileName } from "../../shared/naming.ts";
import type { Book } from "../../shared/schema.ts";

/** A Lua double-quoted string: `\` `"` newline and CR escaped, other control characters removed. */
export function luaString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\p{Cc}/gu, "");
  return `"${escaped}"`;
}

function present(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Content of `custom_metadata.lua` for a book, with the topic label as the series. */
export function sidecarContent(book: Book, topicLabel: string): string {
  const docProps = [
    `        ["authors"] = ${luaString(book.authors.join(", "))},`,
    ...(present(book.description)
      ? [`        ["description"] = ${luaString(book.description)},`]
      : []),
    ...(present(book.language) ? [`        ["language"] = ${luaString(book.language)},`] : []),
    `        ["title"] = ${luaString(book.title)},`,
  ];
  return [
    "return {",
    '    ["custom_props"] = {',
    `        ["series"] = ${luaString(topicLabel)},`,
    "    },",
    '    ["doc_props"] = {',
    ...docProps,
    "    },",
    "}",
    "",
  ].join("\n");
}

/** Path of the metadata file relative to `kobo.booksDir`: `<name>.kepub.sdr/custom_metadata.lua`. */
export function sidecarMetadataPath(book: Pick<Book, "id" | "title" | "authors">): string {
  return `${koboFileName(book, "sidecar")}/${KOBO_SIDECAR_METADATA_FILE}`;
}
