import type React from "react";
import { useCallback, useState } from "react";

/**
 * Moves `id` to the place of `target` inside `shown` (the list as the user sees it). Ids not shown (filtered out)
 * keep their previous relative order after the shown ones. Pure, so it can be tested.
 */
export function moveInOrder(
  shown: readonly string[],
  previous: readonly string[],
  id: string,
  target: string,
): string[] {
  if (id === target) return [...previous];
  const from = shown.indexOf(id);
  const to = shown.indexOf(target);
  if (from < 0 || to < 0) return [...previous];
  const next = shown.filter((x) => x !== id);
  next.splice(to, 0, id);
  const rest = previous.filter((x) => !next.includes(x));
  return [...next, ...rest];
}

function read(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** A list order chosen by drag and drop, kept in this browser (localStorage; fine when storage is blocked). */
export function useManualOrder(storageKey: string): [string[], (next: string[]) => void] {
  const [order, setOrder] = useState<string[]>(() => read(storageKey));
  const save = useCallback(
    (next: string[]) => {
      setOrder(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // storage blocked: the order lasts until the page is closed
      }
    },
    [storageKey],
  );
  return [order, save];
}

/**
 * Native drag and drop for a list: spread `itemProps(id)` on each `<li>`. Dropping an item on another calls
 * `onMove(draggedId, targetId)`. Links inside are not draggable on their own (the `<li>` is the drag source).
 */
export function useDragReorder(onMove: (id: string, target: string) => void, enabled = true) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const itemProps = (id: string) =>
    enabled
      ? {
          draggable: true,
          "data-dragging": dragging === id ? "" : undefined,
          "data-drop-target": over === id && dragging !== id ? "" : undefined,
          onDragStart: (event: React.DragEvent) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", id);
            setDragging(id);
          },
          onDragOver: (event: React.DragEvent) => {
            if (dragging === null) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setOver(id);
          },
          onDrop: (event: React.DragEvent) => {
            event.preventDefault();
            if (dragging !== null && dragging !== id) onMove(dragging, id);
            setDragging(null);
            setOver(null);
          },
          onDragEnd: () => {
            setDragging(null);
            setOver(null);
          },
        }
      : {};
  return { itemProps };
}
