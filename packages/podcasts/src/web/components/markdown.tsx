import { useMemo, type ComponentProps } from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { TRANSCRIPT_EXCERPT_PLACEHOLDER } from "@core/transcript-guard";
import { remarkMarkPlaceholder, remarkTimestampLinks } from "@podcasts/lib/timestamps";
import { cn } from "@podcasts/lib/utils";

interface MarkdownProps {
  children: string;
  /** When set, `[HH:MM:SS]` / `[MM:SS]` timestamps link to this video (see `timestampVideoId`). */
  timestampVideoId?: string | undefined;
  className?: string;
}

function MarkdownLink({
  node: _node,
  href,
  children,
  ...props
}: ComponentProps<"a"> & { node?: unknown }) {
  const external = href !== undefined && /^https?:\/\//i.test(href);
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      {...props}
    >
      {children}
    </a>
  );
}

const COMPONENTS: Options["components"] = { a: MarkdownLink };

/** Notes and conversations. Raw HTML is not rendered (react-markdown default). */
export function Markdown({ children, timestampVideoId, className }: MarkdownProps) {
  const remarkPlugins = useMemo<Options["remarkPlugins"]>(
    () => [
      remarkGfm,
      [remarkTimestampLinks, { youtubeId: timestampVideoId }],
      [
        remarkMarkPlaceholder,
        { text: TRANSCRIPT_EXCERPT_PLACEHOLDER, className: "redacted-excerpt" },
      ],
    ],
    [timestampVideoId],
  );
  return (
    <div
      className={cn(
        "markdown [&_h1]:font-serif [&_h2]:font-serif [&_h3]:font-serif [&_h4]:font-serif [&_a:hover]:text-brand",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={remarkPlugins} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
