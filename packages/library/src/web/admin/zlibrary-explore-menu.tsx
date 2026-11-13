/**
 * "Esplorazione" menu of a Z-Library result: lists the explorations (loaded when the menu first opens) and offers
 * to create a new one. The list is owned by the sheet, so it is fetched once and shared by all result cards.
 */
import { ChevronDownIcon, CompassIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@ehub/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ehub/ui/components/dropdown-menu";
import type { ExplorationSummary } from "./explore-client";

export interface ExplorationsState {
  status: "idle" | "loading" | "ready" | "error";
  items: ExplorationSummary[];
  error: string | null;
}

const STATUS_LABELS: Record<string, string> = { open: "Aperta", closed: "Chiusa" };

export function explorationStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function ExploreMenu({
  disabled,
  busy,
  state,
  onOpen,
  onPick,
  onNew,
}: {
  disabled: boolean;
  busy: boolean;
  state: ExplorationsState;
  onOpen: () => void;
  onPick: (exploration: ExplorationSummary) => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Opening the create dialog from the menu: the menu's focus return must not steal focus from the dialog.
  const newRequested = useRef(false);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onOpen();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          {busy ? <Loader2Icon className="animate-spin" /> : <CompassIcon />}
          Esplorazione
          <ChevronDownIcon className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-72"
        onCloseAutoFocus={(event) => {
          if (newRequested.current) {
            newRequested.current = false;
            event.preventDefault();
          }
        }}
      >
        <DropdownMenuLabel>Aggiungi a un&apos;esplorazione</DropdownMenuLabel>

        {state.status === "loading" ? (
          <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" aria-hidden />
            Caricamento…
          </div>
        ) : null}

        {state.status === "error" ? (
          <p role="alert" className="px-2 py-2 text-sm text-destructive">
            {state.error}
          </p>
        ) : null}

        {state.status === "ready" && state.items.length === 0 ? (
          <p className="px-2 py-2 text-sm text-muted-foreground">Nessuna esplorazione ancora.</p>
        ) : null}

        {state.items.map((exploration) => (
          <DropdownMenuItem
            key={exploration.id}
            onSelect={() => onPick(exploration)}
            className="flex-col items-start gap-0.5"
          >
            <span className="w-full truncate font-medium">{exploration.title}</span>
            <span className="text-xs text-muted-foreground">
              {explorationStatusLabel(exploration.status)}
            </span>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            newRequested.current = true;
            onNew();
          }}
        >
          <PlusIcon />
          Nuova esplorazione…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
