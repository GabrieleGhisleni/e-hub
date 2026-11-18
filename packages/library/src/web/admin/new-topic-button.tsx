/**
 * "+" that adds a topic from anywhere it is needed (next to the topic filters, next to the topic picker of a book form):
 * a small popover with a name field. The index refreshes after the write (`adminApi`), so the new topic shows up in the
 * filters and in the pickers at once.
 */
import { Loader2Icon, PlusIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@ehub/ui/components/button";
import { Input } from "@ehub/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@ehub/ui/components/popover";
import { adminApi } from "./api";
import { announceError, announceWrite } from "./notify";

export interface NewTopicButtonProps {
  /** Called with the topic that was just created (e.g. to select it in a form). */
  onCreated?: (topic: { id: string; label: string }) => void;
  disabled?: boolean;
}

export function NewTopicButton({ onCreated, disabled }: NewTopicButtonProps) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const name = label.trim();
    if (name === "" || busy) return;
    setBusy(true);
    try {
      const response = await adminApi.addTopic(name);
      announceWrite(`Argomento «${response.topic.label}» aggiunto`, response.report);
      onCreated?.(response.topic);
      setLabel("");
      setOpen(false);
    } catch (error) {
      announceError("Argomento non aggiunto", error);
    }
    setBusy(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label="Nuovo argomento"
          title="Nuovo argomento"
        >
          <PlusIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor="new-topic-name" className="text-sm font-medium">
            Nuovo argomento
          </label>
          <Input
            id="new-topic-name"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Es. Filosofia antica"
            maxLength={80}
            autoFocus
          />
          <Button type="submit" size="sm" disabled={busy || label.trim() === ""}>
            {busy ? <Loader2Icon className="animate-spin" /> : null}
            Aggiungi
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
