"use client";

import { useState, useTransition } from "react";
import { summariseWeekAction } from "@/actions/review";

export function WeekSummary() {
  const [result, setResult] = useState<{
    summary: string;
    suggestion: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          Have the local model write this up in a few sentences.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const response = await summariseWeekAction();
              if (response.success) setResult(response.data);
              else setError(response.error.message);
            });
          }}
          className="rounded-lg border border-border-subtle px-3.5 py-2 text-sm text-text transition-colors hover:bg-surface-subtle disabled:opacity-60"
        >
          {pending ? "Writing…" : result ? "Write it again" : "Summarise my week"}
        </button>
      </div>

      {result && (
        <div className="mt-3 border-t border-border-subtle pt-3">
          <p className="text-sm text-text">{result.summary}</p>
          <p className="mt-2 text-sm text-text-muted">
            <span className="font-medium text-text">Next week: </span>
            {result.suggestion}
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
