"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ApiResponse } from "@/lib/api-response";
import { createCourseAction } from "@/actions/courses";

const FIELD =
  "rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Adding…" : "Add course"}
    </button>
  );
}

export function CourseForm({ defaultTerm }: { defaultTerm: string }) {
  const [state, formAction] = useActionState<ApiResponse<null> | null, FormData>(
    createCourseAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4"
    >
      <div className="flex flex-wrap gap-2">
        <input
          name="code"
          placeholder="CMP2003"
          required
          maxLength={20}
          aria-label="Course code"
          className={`w-32 font-mono ${FIELD}`}
        />
        <input
          name="title"
          placeholder="Data Structures"
          required
          maxLength={160}
          aria-label="Course title"
          className={`min-w-0 flex-1 ${FIELD}`}
        />
        <input
          name="term"
          defaultValue={defaultTerm}
          placeholder="Fall 2026"
          required
          maxLength={60}
          aria-label="Term"
          className={`w-36 ${FIELD}`}
        />
      </div>

      {state && !state.success && (
        <p
          role="alert"
          className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {state.error.message}
        </p>
      )}

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}
