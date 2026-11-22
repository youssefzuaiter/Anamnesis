"use client";

import { useId, useRef, useState } from "react";
import { ProposalCard } from "@/components/proposal-card";
import { LANGUAGES, type LanguageCode } from "@/lib/translate";
import type { ActionProposal } from "@/lib/ai-tools";

type State =
  | { phase: "idle" }
  | { phase: "working"; done: number; total: number | null }
  | { phase: "proposed"; proposalId: string; proposal: ActionProposal; kept: number }
  | { phase: "failed"; message: string };

/**
 * "Translate into a new note" (ROADMAP 57). The server translates line by line, with maths, code and addresses held back, and streams its progress;
 * the translation arrives as a proposal, shown in full, saved only if confirmed. The note itself is never changed.
 */
export function TranslateCard({ noteId }: { noteId: string }) {
  const id = useId();
  const [language, setLanguage] = useState<LanguageCode>("tr");
  const [state, setState] = useState<State>({ phase: "idle" });
  const running = useRef(false);

  async function translate() {
    if (running.current) return;
    running.current = true;
    setState({ phase: "working", done: 0, total: null });
    try {
      const response = await fetch("/api/ai/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId, language }),
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        setState({ phase: "failed", message: body?.error?.message ?? "Could not translate this note." });
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
          else if (event.type === "proposal") setState({ phase: "proposed", proposalId: event.proposalId, proposal: event.proposal, kept: event.kept });
          else if (event.type === "error") setState({ phase: "failed", message: event.error?.message ?? "Could not translate this note." });
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
      <h2 className="text-xs font-semibold text-text-faint">Translate</h2>
      {state.phase === "proposed" ? (
        <>
          {state.kept > 0 && (
            <p className="mt-2 text-xs text-text-muted">
              {state.kept} {state.kept === 1 ? "line" : "lines"} could not be translated safely and {state.kept === 1 ? "is" : "are"} kept as written.
            </p>
          )}
          <ProposalCard proposalId={state.proposalId} proposal={state.proposal} />
        </>
      ) : (
        <>
          <p className="mt-1.5 text-sm text-text-muted">
            Makes a new note in another language, linked back to this one. Formulas, code and addresses are kept exactly. You read it before anything is saved, and it is a machine translation: check it.
          </p>
          <div className="mt-2.5 flex flex-col gap-2">
            <label htmlFor={id} className="text-[13px] font-semibold text-text">Language</label>
            <select id={id} value={language} onChange={(event) => setLanguage(event.target.value as LanguageCode)} disabled={state.phase === "working"} className="min-h-11 w-full min-w-0 rounded-lg border border-control bg-surface px-3 text-sm text-text focus:border-accent focus:outline-none">
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </div>
          <div aria-live="polite" className="mt-2 text-xs text-text-muted">
            {state.phase === "working" && (state.total ? `Translating part ${Math.min(state.done + 1, state.total)} of ${state.total}…` : "Starting…")}
          </div>
          {state.phase === "failed" && <p role="alert" className="mt-2 text-xs text-danger">{state.message}</p>}
          <button type="button" onClick={translate} disabled={state.phase === "working"} className="mt-2.5 min-h-11 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-text transition-colors hover:bg-surface-subtle disabled:cursor-wait disabled:opacity-60">
            {state.phase === "working" ? "Translating…" : "Translate into a new note"}
          </button>
        </>
      )}
    </div>
  );
}
