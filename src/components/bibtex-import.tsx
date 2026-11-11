"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import type { ApiResponse } from "@/lib/api-response";
import { applyImportAction, previewImportAction, type ImportState } from "@/actions/references";

const BUTTON =
  "min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={BUTTON}>
      {pending ? busy : label}
    </button>
  );
}

function Message({ state }: { state: ApiResponse<ImportState> | null }) {
  if (state && !state.success) {
    return (
      <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
        {state.error.message}
      </p>
    );
  }
  return null;
}

/**
 * Import BibTeX in two steps: Preview reads it and says what would happen; Add sends the same text
 * again, and the server reads it afresh, so nothing from the preview is trusted.
 */
export function BibtexImport() {
  const router = useRouter();
  const [previewState, preview] = useActionState(previewImportAction, null);
  const [applyState, apply] = useActionState(applyImportAction, null);
  const [text, setText] = useState("");
  const [dismissed, setDismissed] = useState<ImportState>(null);

  const shown = previewState?.success && previewState.data && "preview" in previewState.data && previewState.data !== dismissed ? previewState.data : null;
  const added = applyState?.success && applyState.data && "added" in applyState.data ? applyState.data.added : null;

  useEffect(() => {
    if (added !== null) router.refresh();
  }, [added, applyState, router]);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4">
      <form action={preview} className="flex flex-col gap-3">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-medium text-text">BibTeX</span>
          <textarea
            name="bibtex"
            rows={5}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={"@article{vaswani2017,\n  title = {Attention is all you need}, …\n}"}
            className="w-full min-w-0 rounded-lg border border-control bg-surface px-3 py-2 font-mono text-xs text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-medium text-text">Or a .bib file</span>
          <input
            type="file"
            name="file"
            accept=".bib,text/x-bibtex,text/plain"
            className="w-full min-w-0 rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2 text-sm text-text file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent"
          />
        </label>
        <Message state={previewState} />
        <div>
          <Submit label="Preview import" busy="Reading…" />
        </div>
      </form>

      {shown && (
        <section aria-label="Import preview" className="flex flex-col gap-2 border-t border-border-subtle pt-3 text-sm">
          <p className="text-text">
            {shown.preview.added.length} new
            {shown.preview.unchanged ? `, ${shown.preview.unchanged} you already have` : ""}
            {shown.preview.differing.length ? `, ${shown.preview.differing.length} with a key you already use (yours is kept)` : ""}
            {shown.preview.problems.length ? `, ${shown.preview.problems.length} that could not be read` : ""}.
          </p>
          {shown.preview.added.length > 0 && (
            <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-text-muted">
              {shown.preview.added.map((ref) => (
                <li key={ref.key} className="break-words">
                  <code className="font-mono text-xs text-text">{ref.key}</code> {ref.title}
                </li>
              ))}
            </ul>
          )}
          {shown.preview.differing.length > 0 && (
            <p className="break-words text-text-muted">
              Kept as yours: {shown.preview.differing.map((ref) => ref.key).join(", ")}.
            </p>
          )}
          {shown.preview.problems.length > 0 && (
            <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-warn">
              {shown.preview.problems.map((problem, index) => (
                <li key={index} className="break-words">
                  Line {problem.line}: {problem.message}
                </li>
              ))}
            </ul>
          )}
          <form
            action={(form) => {
              setDismissed(shown);
              apply(form);
            }}
          >
            <input type="hidden" name="bibtex" value={shown.text} />
            {shown.preview.added.length > 0 && <Submit label={`Add ${shown.preview.added.length} ${shown.preview.added.length === 1 ? "reference" : "references"}`} busy="Adding…" />}
          </form>
        </section>
      )}

      <Message state={applyState} />
      <div aria-live="polite" role="status" className="text-sm text-text">
        {added !== null && !shown && `Added ${added} ${added === 1 ? "reference" : "references"}.`}
      </div>
    </div>
  );
}
