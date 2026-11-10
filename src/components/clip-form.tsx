"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ApiResponse } from "@/lib/api-response";
import { clipUrlAction } from "@/actions/clip";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Clipping…" : "Clip page"}
    </button>
  );
}

export function ClipForm() {
  const [state, formAction] = useActionState<ApiResponse<null> | null, FormData>(clipUrlAction, null);
  // Controlled: React resets a form's uncontrolled fields when its action returns, which would clear
  // the link under a refusal, just when it needs correcting or retrying.
  const [url, setUrl] = useState("");

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-text">Link to a web page</span>
        <input
          type="url"
          name="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required
          maxLength={2000}
          inputMode="url"
          autoComplete="off"
          placeholder="https://example.com/article"
          className="w-full min-w-0 rounded-lg border border-control bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
      </label>

      <div aria-live="polite">
        {state && !state.success && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {state.error.message}
          </p>
        )}
      </div>

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}
