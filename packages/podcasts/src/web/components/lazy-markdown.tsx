import { lazy, Suspense, type ComponentProps } from "react";
import { Skeleton } from "@ehub/ui/components/skeleton";
import { cn } from "@podcasts/lib/utils";

// react-markdown + remark-gfm are only needed on the detail page: own chunk.
const MarkdownImpl = lazy(() =>
  import("@podcasts/components/markdown").then((module) => ({ default: module.Markdown })),
);

type MarkdownProps = ComponentProps<typeof MarkdownImpl>;

/** `<Markdown>` loaded on first use (a few skeleton lines meanwhile). */
export function Markdown(props: MarkdownProps) {
  return (
    <Suspense
      fallback={
        <div className={cn("space-y-3", props.className)} aria-busy="true">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      }
    >
      <MarkdownImpl {...props} />
    </Suspense>
  );
}
