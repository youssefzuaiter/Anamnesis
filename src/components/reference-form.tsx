"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ApiResponse } from "@/lib/api-response";
import type { RefFields, ReferenceType } from "@/lib/bibtex";
import { namesToLines } from "@/lib/reference-input";

const TYPES: { value: ReferenceType; label: string }[] = [
  { value: "article", label: "Journal article" },
  { value: "book", label: "Book" },
  { value: "chapter", label: "Book chapter" },
  { value: "paper", label: "Conference paper" },
  { value: "thesis", label: "Thesis" },
  { value: "report", label: "Report" },
  { value: "web", label: "Web page" },
  { value: "other", label: "Other" },
];

/** What the "container" field is called for each type. */
const CONTAINER: Record<ReferenceType, string> = {
  article: "Journal",
  book: "Series",
  chapter: "Book title",
  paper: "Proceedings title",
  thesis: "Series",
  report: "Series",
  web: "Website name",
  other: "Published in",
};

/** The detail fields the form shows for each type; the others are carried as hidden inputs, never lost. */
function shown(type: ReferenceType): Set<string> {
  const fields = new Set(["container", "doi", "url"]);
  if (type === "article" || type === "other") ["volume", "issue"].forEach((f) => fields.add(f));
  if (type === "article" || type === "chapter" || type === "paper" || type === "other") fields.add("pages");
  if (type === "chapter") fields.add("editors");
  if (type === "book" || type === "other") fields.add("edition");
  if (type !== "web" && type !== "thesis") fields.add("publisher");
  if (type === "thesis" || type === "report") fields.add("institution");
  if (type === "report") fields.add("number");
  if (type === "thesis") fields.add("degree");
  return fields;
}
const DETAIL_INPUTS = ["container", "volume", "issue", "pages", "editors", "edition", "publisher", "institution", "number", "degree", "doi", "url"];

const INPUT =
  "w-full min-w-0 rounded-lg border border-control bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none";

function Field({ label, name, defaultValue, hint, wide = false, placeholder }: { label: string; name: string; defaultValue?: string; hint?: string; wide?: boolean; placeholder?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 ${wide ? "sm:col-span-2" : ""}`}>
      <span className="text-sm font-medium text-text">{label}</span>
      <input name={name} defaultValue={defaultValue} placeholder={placeholder} maxLength={1000} className={INPUT} />
      {hint && <span className="text-xs text-text-muted">{hint}</span>}
    </label>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

export function ReferenceForm({
  action,
  initial,
  submitLabel,
}: {
  action: (prev: ApiResponse<null> | null, form: FormData) => Promise<ApiResponse<null>>;
  initial?: Partial<RefFields>;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const [type, setType] = useState<ReferenceType>(initial?.type ?? "article");
  // React 19 resets a form's fields to their default values when its action returns, refused or not.
  // The defaults are what was last submitted, so a refusal keeps what was typed.
  const [draft, setDraft] = useState<Record<string, string>>(() => ({
    key: initial?.key ?? "",
    title: initial?.title ?? "",
    authors: namesToLines(initial?.authors),
    year: initial?.year?.toString() ?? "",
    container: initial?.container ?? "",
    volume: initial?.volume ?? "",
    issue: initial?.issue ?? "",
    pages: initial?.pages ?? "",
    editors: namesToLines(initial?.editors),
    edition: initial?.edition ?? "",
    publisher: initial?.publisher ?? "",
    institution: initial?.institution ?? "",
    number: initial?.number ?? "",
    degree: initial?.degree ?? "",
    doi: initial?.doi ?? "",
    url: initial?.url ?? "",
  }));
  const submit = (form: FormData) => {
    setDraft((before) => ({ ...before, ...Object.fromEntries([...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string")) }));
    formAction(form);
  };

  return (
    <form action={submit} className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-medium text-text">Type</span>
          <select name="type" value={type} onChange={(event) => setType(event.target.value as ReferenceType)} className={INPUT}>
            {TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="Citation key"
          name="key"
          defaultValue={draft.key}
          placeholder="vaswani2017"
          hint="Cite it in a note as [@key]. Letters, digits and _ : . - /"
        />
        <Field label="Title" name="title" defaultValue={draft.title} wide />
        <label className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
          <span className="text-sm font-medium text-text">Authors</span>
          <textarea
            name="authors"
            rows={3}
            defaultValue={draft.authors}
            placeholder={"Vaswani, Ashish\nShazeer, Noam"}
            className={INPUT}
          />
          <span className="text-xs text-text-muted">One per line, family name first. Put an organisation in braces: {"{World Health Organization}"}.</span>
        </label>
        <Field label="Year" name="year" defaultValue={draft.year} placeholder="2017" hint="Leave empty for no date (n.d.)." />
        <Field label={CONTAINER[type]} name="container" defaultValue={draft.container} />
        {(type === "article" || type === "other") && (
          <>
            <Field label="Volume" name="volume" defaultValue={draft.volume} />
            <Field label="Issue" name="issue" defaultValue={draft.issue} />
          </>
        )}
        {(type === "article" || type === "chapter" || type === "paper" || type === "other") && (
          <Field label="Pages" name="pages" defaultValue={draft.pages} placeholder="436–444" />
        )}
        {type === "chapter" && (
          <label className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium text-text">Editors</span>
            <textarea name="editors" rows={2} defaultValue={draft.editors} className={INPUT} />
          </label>
        )}
        {(type === "book" || type === "other") && <Field label="Edition" name="edition" defaultValue={draft.edition} placeholder="2" />}
        {type !== "web" && type !== "thesis" && <Field label="Publisher" name="publisher" defaultValue={draft.publisher} />}
        {(type === "thesis" || type === "report") && (
          <Field label={type === "thesis" ? "University" : "Institution"} name="institution" defaultValue={draft.institution} />
        )}
        {type === "report" && <Field label="Report number" name="number" defaultValue={draft.number} />}
        {type === "thesis" && (
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium text-text">Degree</span>
            <select name="degree" defaultValue={draft.degree} className={INPUT}>
              <option value="">Not given</option>
              <option value="doctoral">Doctoral dissertation</option>
              <option value="masters">Master&apos;s thesis</option>
            </select>
          </label>
        )}
        <Field label="DOI" name="doi" defaultValue={draft.doi} placeholder="10.1038/nature14539" />
        <Field label="Link" name="url" defaultValue={draft.url} placeholder="https://…" />
      </div>

      {DETAIL_INPUTS.filter((field) => !shown(type).has(field) && draft[field]).map((field) => (
        <input key={field} type="hidden" name={field} value={draft[field]} />
      ))}

      <div aria-live="polite">
        {state && !state.success && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {state.error.message}
          </p>
        )}
      </div>
      <div>
        <Submit label={submitLabel} />
      </div>
    </form>
  );
}
