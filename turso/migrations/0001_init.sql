-- e-hub on Turso (libSQL/SQLite): one table per kind of document, all with the same shape (docs/hosting.md, "Dati").
-- Only the API on the Pi talks to the database (with the database token), so there is nothing to grant per user.
-- `data` is JSON text: SQLite keeps it as written, so key order survives (unlike a Postgres jsonb).
-- Applied by `pnpm --filter @ehub/store db:migrate --apply`; every statement is idempotent.

-- books: book.json of every book
CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL);
-- book_summaries: summary.json (LLM summaries)
CREATE TABLE IF NOT EXISTS book_summaries (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL);
-- book_highlights: highlights.json (pulled from the Kobo)
CREATE TABLE IF NOT EXISTS book_highlights (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL);
-- book_markdown: notes.md / recall.md / study.md; id '<book>:<kind>', data {"text": "..."}
CREATE TABLE IF NOT EXISTS book_markdown (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL);
-- topics: topics.json, a single row with id 'all'
CREATE TABLE IF NOT EXISTS topics (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL);
-- shows / episodes / conversations: podcasts
CREATE TABLE IF NOT EXISTS shows (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS episodes (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL);
-- notes: notes thread of a book or episode; id '<module>:<item>'
CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL);
-- explorations: triage of books before reading them
CREATE TABLE IF NOT EXISTS explorations (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL);
-- chats: chat histories (reserved)
CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL);
-- kobo_queue: books waiting to be synced to the Kobo; id = book id
CREATE TABLE IF NOT EXISTS kobo_queue (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL);
