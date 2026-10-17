"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ApiResponse } from "@/lib/api-response";
import { PROJECT_CATEGORIES, type ProjectCategory } from "@/lib/domain";

type GoalAction = (
  prevState: ApiResponse<null> | null,
  formData: FormData,
) => Promise<ApiResponse<null>>;

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

// yyyy-mm-dd for a <input type="date"> defaultValue, local — not toISOString,
// which would shift the date at timezone offsets behind UTC.
function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function GoalForm({
  action,
  submitLabel,
  initial,
  resetOnSuccess = false,
}: {
  action: GoalAction;
  submitLabel: string;
  resetOnSuccess?: boolean;
  initial?: {
    title: string;
    description: string | null;
    category: ProjectCategory;
    targetDate: Date | null;
  };
}) {
  const [state, formAction] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state?.success) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4"
    >
      <input
        name="title"
        defaultValue={initial?.title}
        placeholder="Goal — e.g. Land an internship by June"
        required
        maxLength={200}
        aria-label="Goal title"
        className="w-full rounded-lg border border-border-subtle bg-surface-raised px-3 py-2 text-sm font-medium text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
      />

      <textarea
        name="description"
        defaultValue={initial?.description ?? ""}
        placeholder="What does achieving this actually look like? (optional)"
        rows={2}
        maxLength={5000}
        aria-label="Description"
        className="w-full resize-y rounded-lg border border-border-subtle bg-surface-raised px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
      />

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          Category
          <select
            name="category"
            defaultValue={initial?.category ?? "University"}
            aria-label="Category"
            className="w-44 rounded-lg border border-border-subtle bg-surface-raised px-2.5 py-1.5 text-sm text-text focus:border-accent focus:outline-none"
          >
            {PROJECT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-text-muted">
          Target date (optional)
          <input
            type="date"
            name="targetDate"
            defaultValue={
              initial?.targetDate ? toDateInputValue(initial.targetDate) : ""
            }
            aria-label="Target date"
            className="rounded-lg border border-border-subtle bg-surface-raised px-2.5 py-1.5 text-sm text-text focus:border-accent focus:outline-none"
          />
        </label>
      </div>

      {state && !state.success && (
        <p
          role="alert"
          className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {state.error.message}
        </p>
      )}

      {state?.success && !resetOnSuccess && (
        <p role="status" className="text-sm text-text-muted">
          Saved.
        </p>
      )}

      <div>
        <SubmitButton label={submitLabel} />
      </div>
    </form>
  );
}
