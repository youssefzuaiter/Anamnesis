"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ApiResponse } from "@/lib/api-response";
import type { ProjectOption } from "@/lib/domain";
import { ProjectSelect } from "@/components/project-select";

type EventAction = (
  prevState: ApiResponse<null> | null,
  formData: FormData,
) => Promise<ApiResponse<null>>;

type EventFormProps = {
  action: EventAction;
  submitLabel: string;
  resetOnSuccess?: boolean;
  projects: ProjectOption[];
  initial?: {
    title: string;
    description: string | null;
    location: string | null;
    startTime: string;
    endTime: string;
    projectId: string | null;
  };
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

export function EventForm({
  action,
  submitLabel,
  initial,
  projects,
  resetOnSuccess = false,
}: EventFormProps) {
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
        placeholder="Event title"
        required
        maxLength={200}
        aria-label="Event title"
        className="w-full rounded-lg border border-control bg-surface px-3 py-2 text-sm font-medium text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
      />

      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          Starts
          <input
            type="datetime-local"
            name="startTime"
            defaultValue={initial?.startTime}
            required
            aria-label="Start time"
            className="rounded-lg border border-control bg-surface px-2.5 py-1.5 text-sm text-text focus:border-accent focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-text-muted">
          Ends
          <input
            type="datetime-local"
            name="endTime"
            defaultValue={initial?.endTime}
            required
            aria-label="End time"
            className="rounded-lg border border-control bg-surface px-2.5 py-1.5 text-sm text-text focus:border-accent focus:outline-none"
          />
        </label>

        <ProjectSelect projects={projects} defaultValue={initial?.projectId} />
      </div>

      <input
        name="location"
        defaultValue={initial?.location ?? ""}
        placeholder="Location (optional)"
        maxLength={200}
        aria-label="Location"
        className="w-full rounded-lg border border-control bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
      />

      <textarea
        name="description"
        defaultValue={initial?.description ?? ""}
        placeholder="Description (optional)"
        rows={initial ? 4 : 2}
        aria-label="Event description"
        className="w-full resize-y rounded-lg border border-control bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
      />

      {!initial && (
        <fieldset className="flex flex-wrap items-end gap-2 rounded-lg border border-border-subtle p-3">
          <legend className="px-1 text-xs text-text-muted">Repeat (optional)</legend>

          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Frequency
            <select
              name="recurrenceFrequency"
              defaultValue=""
              aria-label="Repeat frequency"
              className="rounded-lg border border-control bg-surface px-2.5 py-1.5 text-sm text-text focus:border-accent focus:outline-none"
            >
              <option value="">Doesn&apos;t repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Times
            <input
              type="number"
              name="recurrenceCount"
              defaultValue={8}
              min={2}
              max={52}
              aria-label="Number of occurrences"
              className="w-20 rounded-lg border border-control bg-surface px-2.5 py-1.5 text-sm text-text focus:border-accent focus:outline-none"
            />
          </label>

          <p className="w-full text-xs text-text-faint">
            Creates this many separate events, spaced by frequency, each
            editable and deletable on its own.
          </p>
        </fieldset>
      )}

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
