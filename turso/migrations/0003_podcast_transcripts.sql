CREATE TABLE podcast_transcripts (user_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL, PRIMARY KEY (user_id, id));
