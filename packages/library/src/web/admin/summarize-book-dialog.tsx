/** "Genera sintesi" / "Rigenera sintesi": language and force options, then POST to the summary endpoint. */
import { Loader2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import type { BookDetail } from "@shared/schema";
import { Button } from "@ehub/ui/components/button";
import { Checkbox } from "@ehub/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ehub/ui/components/dialog";
import { Label } from "@ehub/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ehub/ui/components/select";
import { adminApi } from "./api";
import { announceSummary } from "./notify";
import {
  summaryFailure,
  summaryLanguageOptions,
  type LanguageOption,
  type SummaryFailure,
} from "./lib/summary";

export const SUMMARY_BUSY_TEXT = "Sto generando la sintesi… può richiedere qualche minuto";

export function SummarizeBookDialog({
  book,
  open,
  onOpenChange,
}: {
  book: BookDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const hasSummary = book.summary !== null;
  const options = useMemo(() => summaryLanguageOptions(book.language), [book.language]);
  const [language, setLanguage] = useState("it");
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<SummaryFailure | null>(null);

  function handleOpenChange(next: boolean) {
    if (busy) return; // The run cannot be cancelled from here: keep the dialog until it ends.
    if (!next) setFailure(null);
    onOpenChange(next);
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const response = await adminApi.summarizeBook(book.id, { language, force });
      setBusy(false);
      announceSummary(response);
      onOpenChange(false);
    } catch (error) {
      setFailure(summaryFailure(error));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{hasSummary ? "Rigenera sintesi" : "Genera sintesi"}</DialogTitle>
          <DialogDescription>
            Il modello legge il testo di ogni capitolo e scrive una sintesi del libro e dei singoli
            capitoli. Le sintesi finiscono in <code>summary.json</code>, pubblicato con il sito.
          </DialogDescription>
        </DialogHeader>
        <SummarizeForm
          options={options}
          language={language}
          onLanguageChange={setLanguage}
          force={force}
          onForceChange={setForce}
          busy={busy}
          failure={failure}
          hasSummary={hasSummary}
          onSubmit={() => void submit()}
          onCancel={() => handleOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

export interface SummarizeFormProps {
  options: readonly LanguageOption[];
  language: string;
  onLanguageChange: (language: string) => void;
  force: boolean;
  onForceChange: (force: boolean) => void;
  busy: boolean;
  failure: SummaryFailure | null;
  hasSummary: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}

/** The dialog body (exported on its own so it can be rendered without a portal). */
export function SummarizeForm({
  options,
  language,
  onLanguageChange,
  force,
  onForceChange,
  busy,
  failure,
  hasSummary,
  onSubmit,
  onCancel,
}: SummarizeFormProps) {
  return (
    <>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="summary-language">Lingua della sintesi</Label>
          <Select value={language} onValueChange={onLanguageChange} disabled={busy}>
            <SelectTrigger id="summary-language" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-start gap-3">
          <Checkbox
            id="summary-force"
            checked={force}
            onCheckedChange={(checked) => onForceChange(checked === true)}
            disabled={busy}
            className="mt-0.5"
          />
          <div className="grid gap-1">
            <Label htmlFor="summary-force">Rigenera anche il testo</Label>
            <p className="text-sm text-muted-foreground">
              Riscrive anche le sintesi dei capitoli già presenti, invece di riusare quelle salvate.
            </p>
          </div>
        </div>

        {busy ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            {SUMMARY_BUSY_TEXT}
          </p>
        ) : null}

        {failure ? (
          <div role="alert" className="grid gap-1 text-sm text-destructive">
            <p>{failure.message}</p>
            {failure.hint ? <p>{failure.hint}</p> : null}
          </div>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Annulla
        </Button>
        <Button onClick={onSubmit} disabled={busy}>
          {busy ? (
            <>
              <Loader2Icon className="animate-spin" />
              Generazione…
            </>
          ) : hasSummary ? (
            "Rigenera"
          ) : (
            "Genera"
          )}
        </Button>
      </DialogFooter>
    </>
  );
}
