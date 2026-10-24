"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ApiResponse } from "@/lib/api-response";
import { importPdfAction } from "@/actions/notes";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Importing…" : "Import PDF"}
    </button>
  );
}

export function PdfImportForm() {
  const [state, formAction] = useActionState<ApiResponse<null> | null, FormData>(
    importPdfAction,
    null,
  );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4"
    >
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-text">PDF file</span>
        <input
          type="file"
          name="file"
          accept="application/pdf"
          required
          aria-label="PDF file"
          className="w-full rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2 text-sm text-text file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent"
        />
      </label>

      <input
        name="title"
        placeholder="Title (optional — defaults to the filename)"
        maxLength={200}
        aria-label="Note title override"
        className="w-full rounded-lg border border-control bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
      />

      {state && !state.success && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error.message}
        </p>
      )}

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}
