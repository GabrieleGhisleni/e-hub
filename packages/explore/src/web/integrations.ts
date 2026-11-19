import type { ComponentType } from "react";
import type { BookSource } from "../schema.ts";

export interface ZlibrarySelection {
  key: string;
  title: string;
  author: string;
  download: () => Promise<File>;
}

export type ZlibraryPicker = ComponentType<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selection: {
    pick: (book: ZlibrarySelection) => Promise<void> | void;
    selectedKeys?: ReadonlySet<string>;
    label: string;
  };
}>;

export type SourceCover = ComponentType<{ source: BookSource; explorationId: string; privateCover: boolean }>;
