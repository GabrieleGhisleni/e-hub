import type { ReactNode } from "react";
import { cn } from "../utils";

/** Page width and side gutters shared by every page and by the shell's header and footer. */
export function Container({
  className,
  children,
  as: Tag = "div",
}: {
  className?: string;
  children?: ReactNode;
  as?: "div" | "section" | "header" | "footer" | "main";
}) {
  return (
    <Tag className={cn("mx-auto w-full max-w-[100rem] px-4 sm:px-6 lg:px-10", className)}>
      {children}
    </Tag>
  );
}
