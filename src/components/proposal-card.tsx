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
  note_append: "Add to note",
  task_reschedule: "Reschedule",
};

/** What the confirm button says: a create names what it makes, an edit what it does. */
const CONFIRM_LABEL: Record<ActionProposal["kind"], string> = {
  task: "Create task",
  event: "Create event",
  note: "Create note",
  goal: "Create goal",
  note_append: "Add to note",
  task_reschedule: "Reschedule",
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

function heading(proposal: ActionProposal): string {
  return proposal.kind === "note_append" || proposal.kind === "task_reschedule" ? proposal.targetTitle : proposal.title;
}

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
  if (proposal.kind === "note_append") {
    return `Adds ${proposal.text.length.toLocaleString("en")} characters to the end of this note. History keeps the version before.`;
  }
  if (proposal.kind === "task_reschedule") {
    const from = proposal.fromDue ? DATE_TIME.format(new Date(proposal.fromDue)) : "no due date";
    return `Due ${from} → ${DATE_TIME.format(new Date(proposal.toDue))}${proposal.clearsBlock ? " · its planned block is cleared" : ""}`;
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
  const isEdit = proposal.kind === "note_append" || proposal.kind === "task_reschedule";

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
    <div className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--ai)_40%,var(--border))] bg-surface p-3">
      <div className="flex items-start gap-2.5">
        <span className="shrink-0 rounded-full bg-ai-soft px-2 py-0.5 text-xs font-semibold text-ai">
          {KIND_LABEL[proposal.kind]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text">{heading(proposal)}</p>
          <p className="mt-0.5 text-xs text-text-muted">{describe(proposal)}</p>
        </div>
      </div>

      {proposal.kind === "note_append" && (
        // Exactly what will be written, as plain text: nothing here is rendered as Markdown or HTML.
        <pre
          aria-label="Text to add"
          className="mt-2.5 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-surface-subtle p-2.5 font-sans text-xs leading-relaxed text-text"
        >
          {proposal.text}
        </pre>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}

      {state === "created" ? (
        <p className="mt-2.5 text-xs font-semibold text-ok">{isEdit ? "Done." : "Created."}</p>
      ) : state === "declined" ? (
        <p className="mt-2.5 text-xs text-text-muted">Declined — nothing was saved.</p>
      ) : (
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={confirm}
            disabled={state === "busy"}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {state === "busy" ? "Saving…" : CONFIRM_LABEL[proposal.kind]}
          </button>
          <button
            type="button"
            onClick={decline}
            disabled={state === "busy"}
            className="rounded-lg px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:text-text disabled:opacity-60"
          >
            Decline
          </button>
          <span className="ml-auto text-xs text-text-faint">
            Needs your confirmation
          </span>
        </div>
      )}
    </div>
  );
}
