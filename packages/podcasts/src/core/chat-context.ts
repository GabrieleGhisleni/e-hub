/**
 * System prompt for the chat about one episode (docs/chat.md §3, source `episode`).
 * Node only: reads the episode, its show and its local transcript. The whole transcript goes into the
 * prompt, compacted: consecutive segments of the same speaker become one line per turn,
 * `[mm:ss] Speaker: text` (`[h:mm:ss]` from one hour on). The UI turns those brackets into YouTube links.
 */
import { estimateTokens, type ToolSet } from "@ehub/chat/node";
import { EPISODE_TOOLS_TOKENS, episodeChatTools } from "./chat-tools";
import { NotFoundError } from "./errors";
import type { Episode, Show, Transcript } from "./schema";
import { readEpisode, readShowIfExists, readTranscriptIfExists } from "./store";

/** Same rule as the transcript export: segments without speakers merge within this many seconds. */
const PARAGRAPH_SECONDS = 75;

/** Re-exported so consumers of this module can tell "not found" from other failures. */
export { NotFoundError, ValidationError } from "./errors";

export type EpisodeChatContext = {
  title: string;
  /** System prompt (Italian), with metadata, summary, notes, chapters and the compacted transcript. */
  system: string;
  /** Estimated tokens of `system` and the tools (`estimateTokens`). */
  tokens: number;
  /** `propose_episode_edit`: lets the model propose changes to the summary / notes / tags / guests. */
  tools: ToolSet;
};

/** A note the user wrote in the notes thread of the episode page (`packages/notes`). */
export type ThreadNote = { body: string; pinned?: boolean; createdAt?: string };

/** `mm:ss`, or `h:mm:ss` from one hour on. */
export function formatChatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = String(s % 60).padStart(2, "0");
  if (hours === 0) return `${String(minutes).padStart(2, "0")}:${secs}`;
  return `${hours}:${String(minutes).padStart(2, "0")}:${secs}`;
}

type Turn = { speaker?: string; start: number; texts: string[] };

/** Merges consecutive segments into turns and renders one `[time] Speaker: text` line per turn. */
export function compactTranscript(segments: Transcript["segments"]): string[] {
  const turns: Turn[] = [];
  for (const segment of segments) {
    const text = segment.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const last = turns.at(-1);
    const sameTurn =
      last !== undefined &&
      last.speaker === segment.speaker &&
      (segment.speaker !== undefined || segment.start - last.start < PARAGRAPH_SECONDS);
    if (sameTurn) last.texts.push(text);
    else turns.push({ speaker: segment.speaker, start: segment.start, texts: [text] });
  }
  return turns.map((turn) => {
    const label = turn.speaker ? `${turn.speaker}: ` : "";
    return `[${formatChatTimestamp(turn.start)}] ${label}${turn.texts.join(" ")}`;
  });
}

function renderSystemPrompt(
  episode: Episode,
  show: Show | undefined,
  transcript: Transcript,
  threadNotes: readonly ThreadNote[],
): string {
  const lines: string[] = [
    "Sei un assistente che aiuta l'utente a esplorare un episodio di podcast. Rispondi nella lingua in cui l'utente scrive.",
    "",
    "Regole:",
    "- Basati sulla trascrizione dell'episodio qui sotto. Se la risposta non c'è, dillo chiaramente (\"Nell'episodio non se ne parla\") invece di inventare.",
    "- Quando citi un momento, usa il timestamp della trascrizione tra parentesi quadre, così com'è, per esempio [12:34].",
    "- Cita le parole dell'episodio solo quando servono, e in citazioni brevi tra virgolette. Non riportare passaggi lunghi.",
    "- Non attribuire a un ospite affermazioni che non compaiono nella trascrizione.",
    "- Hai davanti la scheda dell'episodio dell'utente: punti chiave, Appunti e note. Leggile quando servono (ad esempio per rispondere «cosa ho scritto?»), senza ripeterle se non richiesto.",
    "- Se l'utente chiede di cambiare punti chiave, Appunti, tag o ospiti, chiama propose_episode_edit con i campi nuovi COMPLETI: sostituiscono quelli attuali, quindi riporta anche le parti da mantenere. L'utente rivede e conferma: non dire mai che è stato salvato. Le note del thread non si modificano da qui.",
    "",
    "## Episodio",
    `- Titolo: ${episode.title}`,
    `- Show: ${show?.name ?? episode.show}`,
  ];
  if (episode.guests.length > 0) lines.push(`- Ospiti: ${episode.guests.join(", ")}`);
  if (episode.publishedAt) lines.push(`- Data di pubblicazione: ${episode.publishedAt}`);
  lines.push(`- Link: ${episode.url}`);

  if (episode.summary.length > 0) {
    lines.push("", "## Punti chiave (dalla scheda dell'episodio)", ...episode.summary.map((point) => `- ${point}`));
  }
  lines.push(
    "",
    "## Appunti dell'episodio (campo «Appunti» della scheda, Markdown)",
    episode.notes.trim() || "(vuoto)",
  );
  if (threadNotes.length > 0) {
    lines.push(
      "",
      "## Note dell'utente (thread in fondo alla pagina, dalla più vecchia)",
      ...threadNotes.map(
        (note, index) =>
          `### Nota ${index + 1}${note.pinned ? " (fissata)" : ""}${note.createdAt ? `, ${note.createdAt.slice(0, 10)}` : ""}\n${note.body.trim()}`,
      ),
    );
  }

  const chapters = [...transcript.chapters].sort((a, b) => a.start - b.start);
  if (chapters.length > 0) {
    lines.push(
      "",
      "## Capitoli",
      ...chapters.map((chapter) => `[${formatChatTimestamp(chapter.start)}] ${chapter.title}`),
    );
  }

  lines.push(
    "",
    "=== INIZIO TRASCRIZIONE ===",
    ...compactTranscript(transcript.segments),
    "=== FINE TRASCRIZIONE ===",
  );
  return lines.join("\n");
}

/**
 * Builds the chat context of an episode. Throws NotFoundError when the episode or its local transcript is missing
 * (an invalid slug throws ValidationError, from `assertSlug`).
 */
export async function buildEpisodeChatContext(
  slug: string,
  options: { threadNotes?: readonly ThreadNote[] } = {},
): Promise<EpisodeChatContext> {
  const episode = await readEpisode(slug);
  const transcript = await readTranscriptIfExists(slug);
  if (!transcript) throw new NotFoundError(`episode '${slug}' has no local transcript`);
  const show = await readShowIfExists(episode.show);
  const system = renderSystemPrompt(episode, show, transcript, options.threadNotes ?? []);
  return {
    title: episode.title,
    system,
    tokens: estimateTokens(system) + EPISODE_TOOLS_TOKENS,
    tools: episodeChatTools(),
  };
}
