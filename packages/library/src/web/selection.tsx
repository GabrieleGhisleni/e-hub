/**
 * Library selection for bulk edit (admin only). Public mode never renders the provider, so every card reads
 * the inert default (`enabled: false`) and stays a plain link.
 */
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

export interface LibrarySelection {
  /** True only under `SelectionProvider` (admin mode). */
  enabled: boolean;
  /** Selection mode on: grid cards toggle selection instead of opening the book. */
  selecting: boolean;
  selectedIds: ReadonlySet<string>;
  setSelecting: (on: boolean) => void;
  toggle: (id: string) => void;
  /** Replaces the selection (e.g. "select all visible"). */
  setSelected: (ids: Iterable<string>) => void;
  clear: () => void;
}

const noop = () => {};

const NO_SELECTION: LibrarySelection = Object.freeze({
  enabled: false,
  selecting: false,
  selectedIds: new Set<string>(),
  setSelecting: noop,
  toggle: noop,
  setSelected: noop,
  clear: noop,
});

const SelectionContext = createContext<LibrarySelection>(NO_SELECTION);

export function useLibrarySelection(): LibrarySelection {
  return useContext(SelectionContext);
}

/** Stateful selection. Rendered by the root layout only when `__ELIB_ADMIN__` (dead code in the Pages build). */
export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selecting, setSelectingState] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const value = useMemo<LibrarySelection>(
    () => ({
      enabled: true,
      selecting,
      selectedIds,
      setSelecting: (on) => {
        setSelectingState(on);
        if (!on) setSelectedIds(new Set());
      },
      toggle: (id) =>
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      setSelected: (ids) => setSelectedIds(new Set(ids)),
      clear: () => setSelectedIds(new Set()),
    }),
    [selecting, selectedIds],
  );
  return <SelectionContext value={value}>{children}</SelectionContext>;
}
