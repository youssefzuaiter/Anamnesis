"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Citation } from "@/services/assistant-service";
import type { ActionProposal } from "@/lib/ai-tools";
import { ProposalCard } from "@/components/proposal-card";
import { ScopePicker, scopeLabel, type ScopeChoices } from "@/components/scope-picker";
import { historyForScope, scopeKey, type AssistantScope } from "@/lib/assistant-scope";

type Turn = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  proposals?: { proposalId: string; proposal: ActionProposal }[];
  error?: string;
  /** The scope key it was asked under, so a follow-up under another scope does not carry it. */
  scope?: string;
};

const SUGGESTIONS = [
  "What have I been writing about lately?",
  "Summarise my notes on this week's coursework",
  "What did I decide about my thesis?",
];

function CitationList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;

  return (
    <ol className="mt-3 flex flex-col gap-1.5 border-t border-border-subtle pt-3">
      {citations.map((citation) => (
        <li key={citation.index} className="flex gap-2 text-xs">
          <span className="shrink-0 font-mono font-semibold text-ai">
            [{citation.index}]
          </span>
          <div className="min-w-0">
            {citation.sourceType === "note" ? (
              <Link
                href={`/notes/${citation.sourceId}`}
                className="font-medium text-accent hover:underline"
              >
                {citation.title}
              </Link>
            ) : (
              <span className="font-medium text-text">{citation.title}</span>
            )}
            <p className="mt-0.5 line-clamp-2 text-text-muted">
              {citation.excerpt}
            </p>
          </div>
          <span className="ml-auto shrink-0 font-mono text-text-faint">
            {citation.similarity.toFixed(2)}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function AssistantChat({
  conversationId: initialConversationId = null,
  initialTurns = [],
  variant = "page",
  autoFocus = false,
  scopeChoices,
  initialScope = null,
}: {
  conversationId?: string | null;
  initialTurns?: Turn[];
  /** `panel` fills the docked assistant beside another page. */
  variant?: "page" | "panel";
  autoFocus?: boolean;
  /** When given, the page offers "Ask about" and limits a question to the choice. */
  scopeChoices?: ScopeChoices;
  initialScope?: AssistantScope | null;
} = {}) {
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId,
  );
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState<AssistantScope | null>(initialScope);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const named = scopeChoices ? scopeLabel(scopeChoices, scope) : null;
  const placeholder = named ? `Ask about ${named}…` : "Ask your workspace…";

  async function ask(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || busy) return;

    // Only turns asked under this same scope: see historyForScope.
    const history = historyForScope(turns, scope);
    const asked = scopeKey(scope);

    setQuestion("");
    setBusy(true);
    setTurns((prev) => [
      ...prev,
      { role: "user", content: trimmed, scope: asked },
      { role: "assistant", content: "", scope: asked },
    ]);

    // Declared out here because the finally block reads it.
    let startedThread: string | null = null;

    const updateLast = (patch: Partial<Turn>) =>
      setTurns((prev) => {
        const next = [...prev];
        next[next.length - 1] = { ...next[next.length - 1], ...patch };
        return next;
      });

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, history, conversationId, scope }),
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        updateLast({
          error: body?.error?.message ?? "The assistant is unavailable.",
        });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      const proposals: { proposalId: string; proposal: ActionProposal }[] = [];

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);

          if (event.type === "conversation") {
            // The server opened a thread for this question; later turns carry
            // its id so they land in the same one.
            setConversationId(event.id);
            startedThread = event.id;
          } else if (event.type === "citations") {
            updateLast({ citations: event.citations });
          } else if (event.type === "delta") {
            answer += event.text;
            updateLast({ content: answer });
          } else if (event.type === "proposal") {
            proposals.push({
              proposalId: event.proposalId,
              proposal: event.proposal,
            });
            updateLast({ proposals: [...proposals] });
          } else if (event.type === "error") {
            updateLast({ error: event.error?.message ?? "Something failed." });
          }
        }

        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      }
    } catch {
      updateLast({ error: "Lost connection to the assistant." });
    } finally {
      setBusy(false);
      // A newly opened thread should appear in the list beside the chat.
      if (startedThread) router.refresh();
    }
  }

  return (
    <div
      className={
        variant === "panel"
          ? "flex min-h-0 flex-1 flex-col"
          : "flex h-[calc(100vh-8rem)] flex-col"
      }
    >
      <div ref={scrollRef} className="flex-1 overflow-y-auto pr-1">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <p className="max-w-sm text-sm text-text-muted">
              Ask about anything in your workspace. Answers are grounded in your
              own notes and cite where they came from.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => ask(suggestion)}
                  className="rounded-full border border-border-subtle px-3 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-subtle hover:text-text"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {turns.map((turn, index) => (
              <li
                key={index}
                className={
                  turn.role === "user" ? "flex justify-end" : "flex justify-start"
                }
              >
                <div
                  className={
                    turn.role === "user"
                      ? "max-w-[85%] rounded-2xl rounded-br-sm bg-surface-subtle px-4 py-2.5 text-sm font-medium text-text"
                      : "max-w-[95%] rounded-2xl rounded-bl-sm border border-border-subtle bg-surface px-4 py-3 text-sm text-text"
                  }
                >
                  {turn.error ? (
                    <p role="alert" className="text-danger">
                      {turn.error}
                    </p>
                  ) : turn.content ? (
                    <p className="whitespace-pre-wrap">{turn.content}</p>
                  ) : (
                    <p className="text-text-faint">Searching your workspace…</p>
                  )}

                  {turn.role === "assistant" && turn.citations && !turn.error && (
                    <CitationList citations={turn.citations} />
                  )}

                  {turn.role === "assistant" &&
                    turn.proposals?.map((item) => (
                      <ProposalCard
                        key={item.proposalId}
                        proposalId={item.proposalId}
                        proposal={item.proposal}
                      />
                    ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
        {scopeChoices && (
          <ScopePicker value={scope} choices={scopeChoices} onChange={setScope} />
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            ask(question);
          }}
          className="flex gap-2"
        >
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={placeholder}
            aria-label="Ask your workspace"
            autoFocus={autoFocus}
            disabled={busy}
            className="flex-1 rounded-lg border border-control bg-surface px-3 py-2.5 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy || !question.trim()}
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Thinking…" : "Ask"}
          </button>
        </form>
      </div>
    </div>
  );
}
