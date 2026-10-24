"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  proposePlanAction,
  applyPlanAction,
  type PlanBlockView,
} from "@/actions/plan";
import { Icon } from "@/components/icons";

export function PlanDay() {
  const router = useRouter();
  const [plan, setPlan] = useState<PlanBlockView[] | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const keeping = plan?.filter((block) => !skipped.has(block.taskId)) ?? [];

  return (
    <section
      aria-labelledby="plan-day-title"
      className="rounded-xl bg-surface-subtle p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-56 flex-1">
          <h3 id="plan-day-title" className="text-sm font-semibold text-text">
            Plan my day
          </h3>
          <p className="text-xs text-text-muted">
            Fits your open tasks into the gaps between today&apos;s commitments.
            Nothing moves until you confirm.
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            setMessage(null);
            startTransition(async () => {
              const result = await proposePlanAction();
              if (result.success) {
                setPlan(result.data);
                setSkipped(new Set());
                if (result.data.length === 0) {
                  setMessage("Nothing left to schedule today.");
                }
              } else {
                setError(result.error.message);
              }
            });
          }}
          className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border-strong bg-surface px-3.5 text-sm font-semibold text-text transition-colors hover:bg-surface-hover disabled:opacity-60"
        >
          <Icon name="calendar" />
          {pending && plan === null ? "Working…" : "Propose a plan"}
        </button>
      </div>

      {plan && plan.length > 0 && (
        <>
          <ul className="mt-3 flex flex-col gap-1.5">
            {plan.map((block) => {
              const dropped = skipped.has(block.taskId);
              return (
                <li
                  key={block.taskId}
                  className={`flex items-center gap-3 rounded-lg bg-surface px-3 py-2 text-sm ${
                    dropped ? "opacity-40" : ""
                  }`}
                >
                  <span className="shrink-0 tabular-nums text-xs text-text-muted">
                    {block.start}–{block.end}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-text ${
                      dropped ? "line-through" : ""
                    }`}
                  >
                    {block.title}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setSkipped((current) => {
                        const next = new Set(current);
                        if (next.has(block.taskId)) next.delete(block.taskId);
                        else next.add(block.taskId);
                        return next;
                      })
                    }
                    className="shrink-0 text-xs text-text-muted hover:text-text"
                  >
                    {dropped ? "Put back" : "Skip"}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              disabled={pending || keeping.length === 0}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await applyPlanAction(
                    keeping.map((block) => block.taskId),
                  );
                  if (result.success) {
                    setPlan(null);
                    setMessage(
                      `Scheduled ${result.data.scheduled} ${
                        result.data.scheduled === 1 ? "task" : "tasks"
                      }.`,
                    );
                    // The scheduled tasks now belong in the panels below.
                    router.refresh();
                  } else {
                    setError(result.error.message);
                  }
                });
              }}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Scheduling…" : `Schedule ${keeping.length}`}
            </button>
            <button
              type="button"
              onClick={() => setPlan(null)}
              className="text-sm text-text-muted hover:text-text"
            >
              Discard
            </button>
          </div>
        </>
      )}

      {message && (
        <p role="status" className="mt-3 text-sm text-text-muted">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
