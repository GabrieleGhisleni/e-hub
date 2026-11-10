import { XIcon } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { Input } from "@ehub/ui/components/input";
import { cn } from "@library/lib/utils";

interface TokenInputProps {
  id?: string;
  value: string[];
  onChange: (value: string[]) => void;
  /** Adds what was typed to the list (e.g. `addTags` splits on commas, `addItem` does not). */
  commit: (value: readonly string[], raw: string) => string[];
  /** Autocomplete suggestions for the current text (already filtered). */
  suggest?: (text: string, chosen: readonly string[]) => string[];
  placeholder?: string;
  label: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Characters that also commit the text while typing. */
  commitOnComma?: boolean;
}

/** Chips + text field. Enter (or comma) adds, Backspace on empty text removes the last chip. */
export function TokenInput({
  id,
  value,
  onChange,
  commit,
  suggest,
  placeholder,
  label,
  disabled,
  invalid,
  commitOnComma = false,
}: TokenInputProps) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const listId = useId();
  const suggestions = suggest && focused ? suggest(text, value) : [];

  function add(raw: string) {
    const next = commit(value, raw);
    if (next.length !== value.length) onChange(next);
    setText("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      add(text);
    } else if (event.key === "," && commitOnComma) {
      event.preventDefault();
      add(text);
    } else if (event.key === "Backspace" && text === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="space-y-1.5">
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={label}>
          {value.map((item) => (
            <li
              key={item}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-secondary pr-1 pl-2.5 text-sm"
            >
              {item}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((v) => v !== item))}
                className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                aria-label={`Rimuovi ${item}`}
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Input
        id={id}
        value={text}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          // Text left in the field is kept as a chip (nobody expects it to vanish).
          if (text.trim() !== "") add(text);
        }}
        aria-describedby={suggestions.length > 0 ? listId : undefined}
        autoComplete="off"
      />
      {suggestions.length > 0 ? (
        <ul id={listId} className="flex flex-wrap gap-1.5" aria-label="Suggerimenti">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                // mousedown fires before the input's blur, so the click is not lost.
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(s);
                }}
                className={cn(
                  "inline-flex h-6 items-center rounded-full border border-dashed border-border px-2 text-xs text-muted-foreground",
                  "hover:border-brand/50 hover:text-foreground",
                )}
              >
                + {s}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
