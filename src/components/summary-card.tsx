"use client";

import { useRef, useState } from "react";
import { ProposalCard } from "@/components/proposal-card";
import type { ActionProposal } from "@/lib/ai-tools";

type State =
  | { phase: "idle" }
  | { phase: "working"; done: number; total: number | null }
  | { phase: "proposed"; proposalId: string; proposal: ActionProposal; dropped: number }
  | { phase: "failed"; message: string };

/**
 * "Summarise into a new note" (ROADMAP 24). The server reads the note section by section and streams
 * its progress; the summary arrives as a proposal, shown in full, saved only if confirmed.
 */
export function SummaryCard({ noteId }: { noteId: string }) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const running = useRef(false);

  async function summarise() {
    if (running.current) return;
    running.current = true;
    setState({ phase: "working", done: 0, total: null });
    try {
      const response = await fetch("/api/ai/summarise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId }),
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        setState({ phase: "failed", message: body?.error?.message ?? "Could not summarise this note." });
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "progress") setState({ phase: "working", done: event.done, total: event.total });
          else if (event.type === "proposal") setState({ phase: "proposed", proposalId: event.proposalId, proposal: event.proposal, dropped: event.dropped });
          else if (event.type === "error") setState({ phase: "failed", message: event.error?.message ?? "Could not summarise this note." });
        }
      }
    } catch {
      setState({ phase: "failed", message: "Could not reach the server. Try again." });
    } finally {
      running.current = false;
    }
  }

  return (
    <div>
      <h2 className="text-xs font-semibold text-text-faint">Summary</h2>
      {state.phase === "proposed" ? (
        <>
          {state.dropped > 0 && (
            <p className="mt-2 text-xs text-text-muted">
              {state.dropped} {state.dropped === 1 ? "point was" : "points were"} left out because the note&apos;s own words did not back {state.dropped === 1 ? "it" : "them"}.
            </p>
          )}
          <ProposalCard proposalId={state.proposalId} proposal={state.proposal} />
        </>
      ) : (
        <>
          <p className="mt-1.5 text-sm text-text-muted">
            The assistant reads this note section by section and drafts a summary as a new note. You read it before anything is saved.
          </p>
          <div aria-live="polite" className="mt-2 text-xs text-text-muted">
            {state.phase === "working" && (state.total ? `Reading part ${Math.min(state.done + 1, state.total)} of ${state.total}…` : "Starting…")}
            {state.phase === "working" && state.total !== null && state.done === state.total && " Writing the overview…"}
          </div>
          {state.phase === "failed" && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {state.message}
            </p>
          )}
          <button
            type="button"
            onClick={summarise}
            disabled={state.phase === "working"}
            className="mt-2.5 min-h-11 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-text transition-colors hover:bg-surface-subtle disabled:cursor-wait disabled:opacity-60"
          >
            {state.phase === "working" ? "Summarising…" : "Summarise into a new note"}
          </button>
        </>
      )}
    </div>
  );
}
