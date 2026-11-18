import { useMemo, type ReactNode } from "react";
import { Input } from "@ehub/ui/components/input";
import { Label } from "@ehub/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ehub/ui/components/select";
import { Textarea } from "@ehub/ui/components/textarea";
import { BOOK_STATUSES, type BookStatus } from "@shared/schema";
import { statusLabel } from "@shared/labels";
import type { BookFormState, FormErrors } from "./lib/book-form";
import { addItem, addTags, suggestTags, type TagUsage } from "./lib/tags";
import { NewTopicButton } from "./new-topic-button";
import { TokenInput } from "./token-input";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} className="mb-1.5 text-sm font-medium">
        {label}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function StatusSelect({
  value,
  onChange,
  id,
  disabled,
  allowEmpty,
  placeholder,
}: {
  value: BookStatus | "";
  onChange: (value: BookStatus) => void;
  id?: string;
  disabled?: boolean;
  allowEmpty?: boolean;
  placeholder?: string;
}) {
  return (
    <Select
      value={value === "" && !allowEmpty ? undefined : value}
      onValueChange={(v) => onChange(v as BookStatus)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder ?? "Stato"} />
      </SelectTrigger>
      <SelectContent>
        {BOOK_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {statusLabel(s)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TopicSelect({
  value,
  onChange,
  topics,
  id,
  disabled,
  placeholder,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  topics: readonly { id: string; label: string }[];
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <Select value={value === "" ? undefined : value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid || undefined}>
        <SelectValue placeholder={placeholder ?? "Scegli un argomento"} />
      </SelectTrigger>
      <SelectContent>
        {topics.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Tag field with autocomplete from the tags already used in the index. */
export function TagsField({
  id,
  value,
  onChange,
  allTags,
  disabled,
  label = "Tag",
  placeholder = "Aggiungi un tag e premi Invio",
}: {
  id?: string;
  value: string[];
  onChange: (value: string[]) => void;
  allTags: readonly TagUsage[];
  disabled?: boolean;
  label?: string;
  placeholder?: string;
}) {
  return (
    <TokenInput
      id={id}
      label={label}
      value={value}
      onChange={onChange}
      commit={addTags}
      commitOnComma
      disabled={disabled}
      placeholder={placeholder}
      suggest={(text, chosen) => suggestTags(allTags, text, chosen).map((u) => u.tag)}
    />
  );
}

interface BookFormFieldsProps {
  idPrefix: string;
  value: BookFormState;
  onChange: (value: BookFormState) => void;
  topics: readonly { id: string; label: string }[];
  allTags: readonly TagUsage[];
  errors: FormErrors;
  disabled?: boolean;
}

/** The metadata form shared by upload and edit. */
export function BookFormFields({
  idPrefix,
  value,
  onChange,
  topics,
  allTags,
  errors,
  disabled,
}: BookFormFieldsProps) {
  const set = useMemo(
    () =>
      <K extends keyof BookFormState>(key: K, v: BookFormState[K]) =>
        onChange({ ...value, [key]: v }),
    [onChange, value],
  );
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
      <Field label="Titolo" htmlFor={id("title")} error={errors.title} className="sm:col-span-2">
        <Input
          id={id("title")}
          value={value.title}
          disabled={disabled}
          aria-invalid={errors.title ? true : undefined}
          onChange={(e) => set("title", e.target.value)}
        />
      </Field>

      <Field
        label="Autori"
        htmlFor={id("authors")}
        error={errors.authors}
        hint="Invio per aggiungerne un altro. Il primo dà il nome al file sul Kobo."
        className="sm:col-span-2"
      >
        <TokenInput
          id={id("authors")}
          label="Autori"
          value={value.authors}
          onChange={(v) => set("authors", v)}
          commit={addItem}
          disabled={disabled}
          invalid={!!errors.authors}
          placeholder="Nome e cognome"
        />
      </Field>

      <Field label="Argomento" htmlFor={id("topic")} error={errors.topic}>
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <TopicSelect
              id={id("topic")}
              value={value.topic}
              onChange={(v) => set("topic", v)}
              topics={topics}
              disabled={disabled}
              invalid={!!errors.topic}
            />
          </div>
          <NewTopicButton disabled={disabled} onCreated={(topic) => set("topic", topic.id)} />
        </div>
      </Field>

      <Field label="Stato" htmlFor={id("status")}>
        <StatusSelect
          id={id("status")}
          value={value.status}
          onChange={(v) => set("status", v)}
          disabled={disabled}
        />
      </Field>

      <Field label="Tag" htmlFor={id("tags")} className="sm:col-span-2">
        <TagsField
          id={id("tags")}
          value={value.tags}
          onChange={(v) => set("tags", v)}
          allTags={allTags}
          disabled={disabled}
        />
      </Field>

      <Field label="Inizio lettura" htmlFor={id("startedAt")} error={errors.startedAt}>
        <Input
          id={id("startedAt")}
          type="date"
          value={value.startedAt}
          disabled={disabled}
          aria-invalid={errors.startedAt ? true : undefined}
          onChange={(e) => set("startedAt", e.target.value)}
        />
      </Field>
      <Field label="Fine lettura" htmlFor={id("finishedAt")} error={errors.finishedAt}>
        <Input
          id={id("finishedAt")}
          type="date"
          value={value.finishedAt}
          disabled={disabled}
          aria-invalid={errors.finishedAt ? true : undefined}
          onChange={(e) => set("finishedAt", e.target.value)}
        />
      </Field>

      <Field label="ISBN" htmlFor={id("isbn")}>
        <Input
          id={id("isbn")}
          value={value.isbn}
          disabled={disabled}
          inputMode="numeric"
          onChange={(e) => set("isbn", e.target.value)}
        />
      </Field>
      <Field label="Lingua" htmlFor={id("language")} hint="Codice, per esempio it o en.">
        <Input
          id={id("language")}
          value={value.language}
          disabled={disabled}
          onChange={(e) => set("language", e.target.value)}
        />
      </Field>
      <Field label="Editore" htmlFor={id("publisher")} className="sm:col-span-2">
        <Input
          id={id("publisher")}
          value={value.publisher}
          disabled={disabled}
          onChange={(e) => set("publisher", e.target.value)}
        />
      </Field>
      <Field label="Anno" htmlFor={id("year")} error={errors.year}>
        <Input
          id={id("year")}
          value={value.year}
          disabled={disabled}
          inputMode="numeric"
          maxLength={4}
          aria-invalid={errors.year ? true : undefined}
          onChange={(e) => set("year", e.target.value)}
        />
      </Field>
      <Field label="Pagine" htmlFor={id("pages")} error={errors.pages}>
        <Input
          id={id("pages")}
          value={value.pages}
          disabled={disabled}
          inputMode="numeric"
          maxLength={5}
          aria-invalid={errors.pages ? true : undefined}
          onChange={(e) => set("pages", e.target.value)}
        />
      </Field>
      <Field label="Traduttore" htmlFor={id("translators")} hint="Invio per aggiungerne un altro.">
        <TokenInput
          id={id("translators")}
          label="Traduttore"
          value={value.translators}
          onChange={(v) => set("translators", v)}
          commit={addItem}
          disabled={disabled}
          placeholder="Nome e cognome"
        />
      </Field>
      <Field label="Descrizione" htmlFor={id("description")} className="sm:col-span-2">
        <Textarea
          id={id("description")}
          value={value.description}
          disabled={disabled}
          rows={6}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>
    </div>
  );
}
