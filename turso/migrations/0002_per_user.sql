-- Multi-user: every row has an owner. Applied once (db:migrate keeps a schema_migrations table), all in one transaction.
-- users.id is the Google `sub`; an owner prepared by the data migration before their first login has the id
-- 'email:<address>' and is renamed (with all their rows) when they log in (packages/store/src/users.ts).
-- Rows that already exist (none in a database that was only created, never filled) go to the user 'legacy'.

CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);

CREATE TABLE books_v2 (user_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL, PRIMARY KEY (user_id, id));
INSERT INTO books_v2 SELECT 'legacy', id, data, updated_at FROM books;
DROP TABLE books;
ALTER TABLE books_v2 RENAME TO books;

CREATE TABLE book_summaries_v2 (user_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL, PRIMARY KEY (user_id, id));
INSERT INTO book_summaries_v2 SELECT 'legacy', id, data, updated_at FROM book_summaries;
DROP TABLE book_summaries;
ALTER TABLE book_summaries_v2 RENAME TO book_summaries;

CREATE TABLE book_highlights_v2 (user_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL, PRIMARY KEY (user_id, id));
INSERT INTO book_highlights_v2 SELECT 'legacy', id, data, updated_at FROM book_highlights;
DROP TABLE book_highlights;
ALTER TABLE book_highlights_v2 RENAME TO book_highlights;

CREATE TABLE book_markdown_v2 (user_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL, PRIMARY KEY (user_id, id));
INSERT INTO book_markdown_v2 SELECT 'legacy', id, data, updated_at FROM book_markdown;
DROP TABLE book_markdown;
ALTER TABLE book_markdown_v2 RENAME TO book_markdown;

CREATE TABLE topics_v2 (user_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL, PRIMARY KEY (user_id, id));
INSERT INTO topics_v2 SELECT 'legacy', id, data, updated_at FROM topics;
DROP TABLE topics;
ALTER TABLE topics_v2 RENAME TO topics;

CREATE TABLE shows_v2 (user_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL, PRIMARY KEY (user_id, id));
INSERT INTO shows_v2 SELECT 'legacy', id, data, updated_at FROM shows;
DROP TABLE shows;
ALTER TABLE shows_v2 RENAME TO shows;

CREATE TABLE episodes_v2 (user_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL, PRIMARY KEY (user_id, id));
INSERT INTO episodes_v2 SELECT 'legacy', id, data, updated_at FROM episodes;
DROP TABLE episodes;
ALTER TABLE episodes_v2 RENAME TO episodes;

CREATE TABLE conversations_v2 (user_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL, PRIMARY KEY (user_id, id));
INSERT INTO conversations_v2 SELECT 'legacy', id, data, updated_at FROM conversations;
DROP TABLE conversations;
ALTER TABLE conversations_v2 RENAME TO conversations;

CREATE TABLE notes_v2 (user_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL, PRIMARY KEY (user_id, id));
INSERT INTO notes_v2 SELECT 'legacy', id, data, updated_at FROM notes;
DROP TABLE notes;
ALTER TABLE notes_v2 RENAME TO notes;

CREATE TABLE explorations_v2 (user_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL, PRIMARY KEY (user_id, id));
INSERT INTO explorations_v2 SELECT 'legacy', id, data, updated_at FROM explorations;
DROP TABLE explorations;
ALTER TABLE explorations_v2 RENAME TO explorations;

CREATE TABLE chats_v2 (user_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL, PRIMARY KEY (user_id, id));
INSERT INTO chats_v2 SELECT 'legacy', id, data, updated_at FROM chats;
DROP TABLE chats;
ALTER TABLE chats_v2 RENAME TO chats;

CREATE TABLE kobo_queue_v2 (user_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL, PRIMARY KEY (user_id, id));
INSERT INTO kobo_queue_v2 SELECT 'legacy', id, data, updated_at FROM kobo_queue;
DROP TABLE kobo_queue;
ALTER TABLE kobo_queue_v2 RENAME TO kobo_queue;
