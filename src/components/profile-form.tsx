"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ApiResponse } from "@/lib/api-response";
import { updateProfileAction } from "@/actions/profile";

const FIELD_CLASS =
  "w-full rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save profile"}
    </button>
  );
}

export function ProfileForm({
  initial,
}: {
  initial: { university: string; program: string; studentId: string };
}) {
  const [state, formAction] = useActionState<ApiResponse<null> | null, FormData>(
    updateProfileAction,
    null,
  );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4"
    >
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        University
        <input
          name="university"
          defaultValue={initial.university}
          required
          maxLength={120}
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Program
        <input
          name="program"
          defaultValue={initial.program}
          required
          maxLength={120}
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Student ID
        <input
          name="studentId"
          defaultValue={initial.studentId}
          maxLength={40}
          className={FIELD_CLASS}
        />
      </label>

      {state && !state.success && (
        <p
          role="alert"
          className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {state.error.message}
        </p>
      )}

      {state?.success && (
        <p role="status" className="text-sm text-text-muted">
          Saved.
        </p>
      )}

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}
