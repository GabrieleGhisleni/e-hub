/**
 * Seam for the local-only features (DESIGN.md §8.5, phase 7).
 *
 * Pages place named `<DevSlot name="…" {...props}>` elements. In production
 * a slot renders its `children` (the read-only default content, often
 * nothing) and `./dev/slots` is never imported: the dynamic `import()` sits
 * inside an `import.meta.env.DEV` check, which Vite replaces with `false`,
 * so the dev code is dropped from the bundle.
 *
 * In dev the module is loaded once, lazily; while it loads (or when it has
 * no component for a slot) the slot renders its children. A slot component
 * receives the slot's props plus `children` and decides what to render: add
 * something next to them, wrap them, or replace them (e.g. an editor instead
 * of the read-only notes).
 */
import { Component, useEffect, useState, type ComponentType, type ReactNode } from "react";
import type { Conversation, Episode, Show } from "@core/schema";

/** Props each slot receives (besides `children`). */
export interface DevSlotPropsMap {
  /** Site header, right side, on every page (e.g. a global "Aggiungi" button). */
  "header-actions": Record<never, never>;
  /** Rendered once at the end of the layout, on every page (e.g. sonner's `<Toaster />`, global dev UI). */
  layout: Record<never, never>;
  /** Home, end of the filter bar (e.g. the "Aggiungi da URL" button). */
  "home-toolbar": { episodes: readonly Episode[]; shows: readonly Show[] };
  /** Home, inside the "no episodes yet" empty state. */
  "home-empty": { shows: readonly Show[] };
  /** Detail header, after the external link buttons (e.g. "Copia per l'agente"). */
  "episode-actions": { episode: Episode; show: Show | undefined };
  /** Detail header, transcript status. Children: the "Nessuna trascrizione" badge when there is no transcript. */
  "episode-transcript": { episode: Episode };
  /** Wraps guests + tags in the detail header. Children: their read-only rendering. */
  "episode-meta": { episode: Episode };
  /** Wraps the summary section. Children: the read-only summary (`null` when empty). */
  "episode-summary": { episode: Episode };
  /** Wraps the notes section. Children: the rendered notes (`null` when empty). */
  "episode-notes": { episode: Episode };
  /** Conversations section header, always visible (e.g. "Aggiungi conversazione"). `conversations` is `undefined` until loaded. */
  "episode-conversations": { episode: Episode; conversations: readonly Conversation[] | undefined };
}

export type DevSlotName = keyof DevSlotPropsMap;

export type DevSlotComponentProps<N extends DevSlotName> = DevSlotPropsMap[N] & {
  children?: ReactNode;
};

/** What `./dev/slots` exports as `slots`: a component per slot name (all optional). */
export type DevSlots = { [N in DevSlotName]?: ComponentType<DevSlotComponentProps<N>> };

export type DevSlotProps<N extends DevSlotName> = { name: N } & DevSlotComponentProps<N>;

let loadedSlots: DevSlots | undefined;
let loadingSlots: Promise<DevSlots> | undefined;

function loadDevSlots(): Promise<DevSlots> {
  if (import.meta.env.DEV) {
    loadingSlots ??= import("./dev/slots").then(
      (module) => {
        // Lets tools (and people) see that the local features are active.
        document.documentElement.dataset.devFeatures = module.DEV_ONLY_MARKER;
        loadedSlots = module.slots;
        return module.slots;
      },
      (error: unknown) => {
        console.error("[dev-slot] cannot load src/web/dev/slots", error);
        loadedSlots = {};
        return loadedSlots;
      },
    );
    return loadingSlots;
  }
  return Promise.resolve({});
}

function useDevSlots(): DevSlots | undefined {
  const [slots, setSlots] = useState(loadedSlots);
  useEffect(() => {
    if (slots) return;
    let active = true;
    void loadDevSlots().then((loaded) => {
      if (active) setSlots(loaded);
    });
    return () => {
      active = false;
    };
  }, [slots]);
  return slots;
}

/** Falls back to the default content if a dev slot throws while rendering. */
class SlotBoundary extends Component<{ name: string; fallback: ReactNode; children: ReactNode }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error(`[dev-slot] slot "${this.props.name}" crashed`, error);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Props as the untyped slot component sees them (the map above is enforced at the call sites). */
type AnySlotProps = Record<string, unknown> & { children?: ReactNode };

function LoadedDevSlot({ name, children, ...props }: { name: DevSlotName } & AnySlotProps) {
  const slots = useDevSlots();
  const Slot = slots?.[name] as ComponentType<AnySlotProps> | undefined;
  if (!Slot) return children ?? null;
  return (
    <SlotBoundary name={name} fallback={children ?? null}>
      <Slot {...props}>{children}</Slot>
    </SlotBoundary>
  );
}

export function DevSlot<N extends DevSlotName>(props: DevSlotProps<N>): ReactNode {
  if (!import.meta.env.DEV) return props.children ?? null;
  return <LoadedDevSlot {...(props as { name: DevSlotName } & AnySlotProps)} />;
}
