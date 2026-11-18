-- e-hub: one table per kind of document, all with the same shape (docs/hosting.md, "Dati").
-- The Pi talks to the database with the service key only; the browser never does, so there are
-- no policies to maintain: row level security is on and nothing is granted to anon/authenticated.

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'books',            -- book.json of every book
    'book_summaries',   -- summary.json (LLM summaries)
    'book_highlights',  -- highlights.json (pulled from the Kobo)
    'book_markdown',    -- notes.md / recall.md / study.md: id '<book>:<kind>', data {"text": "..."}
    'topics',           -- topics.json: a single row, id 'all'
    'shows',            -- podcast shows
    'episodes',         -- podcast episodes
    'conversations',    -- chats saved on an episode
    'notes',            -- notes thread of a book or episode: id '<module>:<item>'
    'explorations',     -- explorations (triage of books)
    'chats',            -- chat histories (reserved)
    'kobo_queue'        -- books waiting to be synced to the Kobo: id = book id
  ]
  loop
    execute format(
      'create table if not exists public.%I (
         id text primary key,
         data jsonb not null,
         updated_at timestamptz not null default now()
       )', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop trigger if exists touch_updated_at on public.%I', t);
    execute format(
      'create trigger touch_updated_at before update on public.%I
         for each row execute function public.touch_updated_at()', t);
  end loop;
end;
$$;

-- Lists are always read in full, ordered by id.
-- Notes and episodes are looked up by id only, so the primary key is the only index needed.
