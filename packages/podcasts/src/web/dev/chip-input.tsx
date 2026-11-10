import { useId, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { Badge } from "@ehub/ui/components/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@ehub/ui/components/command";
import { Input } from "@ehub/ui/components/input";
import { Popover, PopoverAnchor, PopoverContent } from "@ehub/ui/components/popover";

function Chips({
  values,
  onRemove,
  describe,
}: {
  values: readonly string[];
  onRemove: (value: string) => void;
  describe: string;
}) {
  if (values.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={describe}>
      {values.map((value) => (
        <li key={value}>
          <Badge variant="secondary" className="gap-1 pr-1 text-sm">
            {value}
            <button
              type="button"
              onClick={() => onRemove(value)}
              className="grid size-4 place-items-center rounded-full outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Rimuovi ${value}`}
            >
              <X className="size-3" aria-hidden />
            </button>
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/** Guests: free names, Enter or comma adds, chips remove. */
export function GuestsInput({
  values,
  onChange,
}: {
  values: readonly string[];
  onChange: (values: string[]) => void;
}) {
  const [text, setText] = useState("");
  const id = useId();
  const add = () => {
    const name = text.trim();
    if (name && !values.includes(name)) onChange([...values, name]);
    setText("");
  };
  return (
    <div className="space-y-2">
      <Chips
        values={values}
        describe="Ospiti"
        onRemove={(value) => onChange(values.filter((v) => v !== value))}
      />
      <Input
        id={id}
        value={text}
        placeholder="Nome e cognome, poi Invio"
        onChange={(event) => setText(event.target.value)}
        onBlur={add}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add();
          } else if (event.key === "Backspace" && text === "" && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
      />
    </div>
  );
}

export interface TagSuggestion {
  tag: string;
  count: number;
}

/** Lowercase English slug-ish tag as the user types (spaces become hyphens). */
export function cleanTag(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-/, "");
}

/** Tags: input with suggestions from the existing tags (popover + command). */
export function TagInput({
  values,
  onChange,
  suggestions,
  hint,
}: {
  values: readonly string[];
  onChange: (values: string[]) => void;
  suggestions: readonly TagSuggestion[];
  hint?: ReactNode;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const cleaned = cleanTag(text);
  const available = suggestions.filter(
    (s) => !values.includes(s.tag) && (cleaned === "" || s.tag.includes(cleaned)),
  );
  const exact = suggestions.some((s) => s.tag === cleaned) || values.includes(cleaned);

  const add = (tag: string) => {
    const next = cleanTag(tag).replace(/-$/, "");
    if (next && !values.includes(next)) onChange([...values, next]);
    setText("");
  };

  return (
    <div className="space-y-2">
      <Chips
        values={values}
        describe="Tag"
        onRemove={(value) => onChange(values.filter((v) => v !== value))}
      />
      <Popover open={open && (available.length > 0 || (cleaned !== "" && !exact))}>
        <PopoverAnchor asChild>
          <div>
            <Command shouldFilter={false} className="h-auto overflow-visible bg-transparent">
              <CommandInput
                placeholder="Aggiungi tag (inglese, minuscolo)…"
                value={text}
                onValueChange={(value) => {
                  setText(value.replace(/[A-Z]/g, (c) => c.toLowerCase()));
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && cleaned && available.length === 0) {
                    event.preventDefault();
                    add(cleaned);
                  } else if (event.key === "," || event.key === " ") {
                    if (cleaned) {
                      event.preventDefault();
                      add(cleaned);
                    }
                  } else if (event.key === "Backspace" && text === "" && values.length > 0) {
                    onChange(values.slice(0, -1));
                  }
                }}
              />
              <PopoverContent
                align="start"
                className="w-[var(--radix-popover-trigger-width)] p-0"
                onOpenAutoFocus={(event) => event.preventDefault()}
              >
                <CommandList>
                  <CommandEmpty>Nessun tag</CommandEmpty>
                  <CommandGroup>
                    {cleaned !== "" && !exact && (
                      <CommandItem value={`new:${cleaned}`} onSelect={() => add(cleaned)}>
                        Nuovo tag «{cleaned}»
                      </CommandItem>
                    )}
                    {available.slice(0, 30).map((s) => (
                      <CommandItem
                        key={s.tag}
                        value={s.tag}
                        // keep input focus: mouse selection must not blur first
                        onMouseDown={(event) => event.preventDefault()}
                        onSelect={() => add(s.tag)}
                      >
                        <Check className="opacity-0" aria-hidden />
                        {s.tag}
                        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                          {s.count}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </PopoverContent>
            </Command>
          </div>
        </PopoverAnchor>
      </Popover>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
