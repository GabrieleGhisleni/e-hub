import { useState } from "react";
import { AudioLines } from "lucide-react";
import { isYoutubePlaceholder, type ImageCandidate } from "@podcasts/lib/images";
import { cn } from "@podcasts/lib/utils";

interface EpisodeImageProps {
  /** Tried in order; on error (or a YouTube placeholder) the next one is shown. */
  candidates: readonly ImageCandidate[];
  alt: string;
  className?: string;
  /** `eager` for the detail hero image. */
  loading?: "lazy" | "eager";
}

/**
 * 16:9 episode image with a fallback chain (DESIGN.md §6.2). A square show
 * cover is letterboxed on a blurred copy of itself; with nothing left to
 * try, a neutral placeholder is drawn.
 */
export function EpisodeImage({ candidates, alt, className, loading = "lazy" }: EpisodeImageProps) {
  // Remount (restart from the first candidate) when the list changes.
  return (
    <FallbackChain
      key={candidates.map((candidate) => candidate.src).join("\n")}
      candidates={candidates}
      alt={alt}
      className={className}
      loading={loading}
    />
  );
}

function FallbackChain({ candidates, alt, className, loading }: EpisodeImageProps) {
  const [index, setIndex] = useState(0);
  const candidate = candidates[index];
  const next = () => setIndex((current) => current + 1);
  const frame = cn("relative aspect-video overflow-hidden bg-muted", className);

  if (!candidate) {
    return (
      <div className={cn(frame, "grid place-items-center")} data-image-kind="placeholder">
        <AudioLines className="size-1/4 max-h-12 max-w-12 text-muted-foreground/50" aria-hidden />
        {alt && <span className="sr-only">{alt}</span>}
      </div>
    );
  }

  const image = (extra?: string) => (
    <img
      src={candidate.src}
      alt={alt}
      loading={loading}
      decoding="async"
      className={extra}
      onError={next}
      onLoad={(event) => {
        if (isYoutubePlaceholder(candidate.src, event.currentTarget.naturalWidth)) next();
      }}
    />
  );

  if (candidate.kind === "show") {
    return (
      <div className={frame} data-image-kind="show">
        <img
          src={candidate.src}
          alt=""
          aria-hidden
          loading={loading}
          decoding="async"
          className="absolute inset-0 size-full scale-125 object-cover opacity-60 blur-2xl saturate-150"
        />
        {image("relative mx-auto aspect-square h-full object-cover shadow-lg")}
      </div>
    );
  }

  return (
    <div className={frame} data-image-kind="thumbnail">
      {image("size-full object-cover")}
    </div>
  );
}
