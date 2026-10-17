"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ApiResponse } from "@/lib/api-response";
import { PROJECT_CATEGORIES, type ProjectCategory, type GoalOption } from "@/lib/domain";
import { GoalSelect } from "@/components/goal-select";

type ProjectAction = (
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

export function ProjectForm({
  action,
  submitLabel,
  initial,
  goals,
  resetOnSuccess = false,
}: {
  action: ProjectAction;
  submitLabel: string;
  resetOnSuccess?: boolean;
  goals: GoalOption[];
  initial?: { title: string; category: ProjectCategory; goalId: string | null };
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
        placeholder="Project name"
        required
        maxLength={200}
        aria-label="Project title"
        className="w-full rounded-lg border border-border-subtle bg-surface-raised px-3 py-2 text-sm font-medium text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
      />

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

      <GoalSelect goals={goals} defaultValue={initial?.goalId} />

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
