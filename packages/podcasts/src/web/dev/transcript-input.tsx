import { useRef, useState } from "react";
import { AskChannelExport, LocalExport, type TranscriptChoice } from "@core/transcript-import";

export function TranscriptInput({
  videoId,
  onChange,
  allowSkip = false,
  disabled = false,
}: {
  videoId?: string;
  onChange: (value: TranscriptChoice | undefined) => void;
  allowSkip?: boolean;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState(allowSkip ? "none" : "paste");
  const [source, setSource] = useState("");
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{
    title: string;
    id: string;
    count: number;
    first: { start: number; end: number; text: string };
  }>();
  const inputRevision = useRef(0);
  const maxBytes = 8 * 1024 * 1024;

  function read(value: string) {
    inputRevision.current += 1;
    setRaw(value);
    setPreview(undefined);
    onChange(undefined);
    setError("");
    if (!value.trim()) return;
    try {
      if (new Blob([value]).size >= maxBytes) throw new Error("File troppo grande.");
      const json: unknown = JSON.parse(value.replace(/^\uFEFF/, ""));
      if (mode === "paste") {
        const parsed = AskChannelExport.parse(json);
        if (parsed.video_id !== videoId)
          throw new Error(
            "Il video del JSON è diverso da quello dell'episodio. Correggi l'URL o scegli il file corrispondente.",
          );
        setPreview({
          title: parsed.video_title,
          id: parsed.video_id,
          count: parsed.segment_count,
          first: parsed.segments[0]!,
        });
        onChange({ mode, source: "askchannel", data: parsed });
      } else {
        const parsed = LocalExport.parse(json);
        if (parsed.videoId !== videoId) throw new Error("Il file appartiene a un altro video.");
        setPreview({
          title: parsed.model,
          id: parsed.videoId,
          count: parsed.result.segments.length,
          first: parsed.result.segments[0]!,
        });
        onChange({ mode: "local", data: parsed });
      }
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? "Il contenuto deve essere un JSON valido."
          : e instanceof Error && e.name === "ZodError"
            ? "Il JSON non rispetta il formato previsto. Controlla ID, URL, numero e tempi dei segmenti."
            : e instanceof Error
              ? e.message
              : "Impossibile leggere la trascrizione.",
      );
    }
  }

  return (
    <fieldset disabled={disabled} className="space-y-2 rounded-lg border p-3 text-sm">
      <legend className="px-1 font-medium">Trascrizione</legend>
      <select
        aria-label="Modalità trascrizione"
        className="w-full rounded border bg-background p-2"
        value={mode}
        onChange={(event) => {
          const selected = event.target.value;
          setMode(selected);
          setSource("");
          read("");
          if (selected === "api" || selected === "none") onChange({ mode: selected });
        }}
      >
        {allowSkip && <option value="none">Senza trascrizione</option>}
        <option value="api" disabled={!videoId}>
          API · Groq
        </option>
        <option value="local" disabled={!videoId}>
          Elaborazione sul PC
        </option>
        <option value="paste" disabled={!videoId}>
          Copia e incolla
        </option>
      </select>
      {!videoId && <p>Per queste modalità serve un episodio associato a un video YouTube.</p>}
      {mode === "api" && (
        <p>
          Alla conferma, il server invia l'audio a Groq (Whisper Large V3 Turbo). L'elaborazione usa
          la quota o il credito del server.
        </p>
      )}
      {mode === "local" && videoId && (
        <p>
          Esegui <code>python packages/podcasts/scripts/transcribe-local.py {videoId}</code> dal
          repository. Servono Python con openai-whisper, yt-dlp, ffmpeg e spazio per modello e audio
          (prevedi qualche GB). Il terminale mostra l'avanzamento. Carica il JSON prodotto.
          L'inferenza avviene sul PC senza chiavi API.
        </p>
      )}
      {mode === "paste" && videoId && (
        <select
          aria-label="Fonte della trascrizione"
          className="w-full rounded border bg-background p-2"
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            read("");
          }}
        >
          <option value="">Scegli la fonte</option>
          <option value="askchannel">AskChannel</option>
        </select>
      )}
      {videoId && (mode === "local" || (mode === "paste" && source)) && (
        <>
          <input
            aria-label="Carica trascrizione JSON"
            type="file"
            accept=".json,application/json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              read("");
              if (file.size >= maxBytes) {
                setError("File troppo grande.");
                return;
              }
              const revision = inputRevision.current;
              try {
                const value = await file.text();
                if (revision === inputRevision.current) read(value);
              } catch {
                if (revision === inputRevision.current) setError("Impossibile leggere il file.");
              }
            }}
          />
          {mode === "paste" && (
            <textarea
              className="w-full rounded border bg-background p-2"
              aria-label="JSON AskChannel"
              rows={4}
              value={raw}
              onChange={(event) => read(event.target.value)}
            />
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {preview && (
        <div className="break-words">
          <strong>{preview.title}</strong>
          <p>
            {preview.id} · {preview.count} segmenti
          </p>
          <p>
            {preview.first.start}–{preview.first.end} s · {preview.first.text.slice(0, 140)}
          </p>
        </div>
      )}
    </fieldset>
  );
}
