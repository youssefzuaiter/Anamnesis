"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmProposalAction, declineProposalAction } from "@/actions/ai-actions";
import type { ActionProposal } from "@/lib/ai-tools";

const KIND_LABEL: Record<ActionProposal["kind"], string> = {
  task: "Task",
  event: "Event",
  note: "Note",
  goal: "Goal",
};

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const DATE_ONLY = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

function describe(proposal: ActionProposal): string {
  if (proposal.kind === "task") {
    return [
      proposal.dueDate ? `Due ${DATE_ONLY.format(new Date(proposal.dueDate))}` : "No due date",
      `${proposal.priority} priority`,
    ].join(" · ");
  }
  if (proposal.kind === "event") {
    return [
      DATE_TIME.format(new Date(proposal.startTime)),
      proposal.location,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (proposal.kind === "goal") {
    return `${proposal.category} · no target date yet`;
  }
  return "New note";
}

export function ProposalCard({
  proposalId,
  proposal,
}: {
  proposalId: string;
  proposal: ActionProposal;
}) {
  const router = useRouter();
  const [state, setState] = useState<"pending" | "busy" | "created" | "declined">("pending");
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setState("busy");
    setError(null);
    const response = await confirmProposalAction({ proposalId, proposal });

    if (!response.success) {
      setError(response.error.message);
      setState("pending");
      return;
    }

    setState("created");
    router.refresh();
    router.push(response.data.href);
  }

  async function decline() {
    setState("busy");
    await declineProposalAction(proposalId);
    setState("declined");
  }

  return (
    <div className="mt-3 rounded-xl border border-accent bg-surface-raised p-3">
      <div className="flex items-start gap-2.5">
        <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
          {KIND_LABEL[proposal.kind]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text">{proposal.title}</p>
          <p className="mt-0.5 text-xs text-text-muted">{describe(proposal)}</p>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}

      {state === "created" ? (
        <p className="mt-2.5 text-xs text-text-muted">Created.</p>
      ) : state === "declined" ? (
        <p className="mt-2.5 text-xs text-text-muted">Declined — nothing was saved.</p>
      ) : (
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={confirm}
            disabled={state === "busy"}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {state === "busy" ? "Saving…" : `Create ${proposal.kind}`}
          </button>
          <button
            type="button"
            onClick={decline}
            disabled={state === "busy"}
            className="rounded-lg px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:text-text disabled:opacity-60"
          >
            Decline
          </button>
          <span className="ml-auto text-[11px] text-text-faint">
            Needs your confirmation
          </span>
        </div>
      )}
    </div>
  );
}
