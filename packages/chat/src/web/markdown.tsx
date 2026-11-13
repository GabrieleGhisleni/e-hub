/**
 * Default Markdown for assistant replies in the chat panel. Compact prose, links in a new tab,
 * raw HTML is not rendered (react-markdown default). Podcasts pass their own renderer instead.
 */
import { type ComponentProps, createContext, useContext } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@ehub/ui";

function ChatLink({ node: _node, href, children, ...props }: ComponentProps<"a"> & { node?: unknown }) {
  const external = href !== undefined && /^https?:\/\//i.test(href);
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="text-brand underline decoration-brand/45 underline-offset-[0.18em] hover:decoration-current"
      {...props}
    >
      {children}
    </a>
  );
}

const COMPONENTS: Components = { a: ChatLink };

/**
 * Reading size of the chat text: "large" in the expanded panel (bigger font, more space between blocks), "default" in
 * the side panel. Set by `MessageList`; custom renderers can read it with `useChatTextSize`.
 */
export type ChatTextSize = "default" | "large";
export const ChatTextSizeContext = createContext<ChatTextSize>("default");
export const useChatTextSize = () => useContext(ChatTextSizeContext);

export function ChatMarkdown({ children, className }: { children: string; className?: string }) {
  const large = useChatTextSize() === "large";
  return (
    <div
      className={cn(
        large ? "text-[1.0625rem] leading-[1.75]" : "text-sm leading-relaxed",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        large ? "[&_p]:my-3" : "[&_p]:my-2",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-0.5 [&_li>p]:my-0",
        "[&_strong]:font-semibold",
        "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-brand [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
        large
          ? "[&_h1]:mt-4 [&_h1]:font-serif [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:font-serif [&_h2]:text-lg [&_h2]:font-semibold"
          : "[&_h1]:mt-3 [&_h1]:font-serif [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:font-serif [&_h2]:text-base [&_h2]:font-semibold",
        "[&_h3]:mt-3 [&_h3]:font-semibold",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
