"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCardAction, editCardAction } from "@/actions/flashcards";
import { MAX_CLOZE_TEXT } from "@/lib/cloze";
import { MAX_CARD_ANSWER, MAX_CARD_QUESTION } from "@/lib/domain";

export type BrowserCard = {
  id: string;
  question: string;
  answer: string;
  clozeIndex: number | null;
  siblingCount: number;
  courseCode: string | null;
  kind: string;
  due: string;
  weak: string | null;
};

const FIELD =
  "w-full rounded-lg border border-control bg-surface px-3 py-2.5 text-sm text-text focus:border-accent focus:outline-none";
const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-3.5 text-sm font-semibold transition-colors disabled:opacity-60 sm:min-h-9";

/** One card in the browser: its words, where it sits, and Edit and Delete. Only the words are ever sent to be saved. */
export function CardBrowserRow({ card }: { card: BrowserCard }) {
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(card.question);
  const [answer, setAnswer] = useState(card.answer);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const cloze = card.clozeIndex !== null;

  function save() {
    startTransition(async () => {
      const result = await editCardAction(card.id, cloze ? { text: question } : { question, answer });
      if (!result.success) {
        setMessage({ kind: "error", text: result.error.message });
        return;
      }
      setEditing(false);
      setMessage({ kind: "ok", text: "Saved." });
      router.refresh();
    });
  }

  function remove() {
    if (!confirm("Delete this card? Its review history stays in your stats, and the card cannot be brought back.")) return;
    startTransition(async () => {
      const result = await deleteCardAction(card.id);
      if (!result.success) {
        setMessage({ kind: "error", text: result.error.message });
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-72">
          <p className="break-words text-[15px] font-semibold text-text">{card.question}</p>
          <p className="mt-1 break-words text-sm text-text-muted">{cloze ? `Blank ${card.clozeIndex}: ${card.answer}` : card.answer}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
            {card.courseCode && <span className="rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent-ink">{card.courseCode}</span>}
            <span>{card.kind}</span>
            <span aria-hidden>·</span>
            <span>{card.due}</span>
            {card.weak && (
              <>
                <span aria-hidden>·</span>
                <span className="font-semibold text-warn">{card.weak}</span>
              </>
            )}
          </p>
        </div>
        {!editing && (
          <div className="flex w-full gap-2 sm:w-auto sm:gap-1">
            <button
              type="button"
              onClick={() => {
                setQuestion(card.question);
                setAnswer(card.answer);
                setMessage(null);
                setEditing(true);
              }}
              className={`${BUTTON} flex-1 border border-border-strong text-text hover:bg-surface-subtle sm:flex-none`}
            >
              Edit
            </button>
            <button type="button" disabled={pending} onClick={remove} className={`${BUTTON} flex-1 text-danger hover:bg-danger-soft sm:flex-none`}>
              {pending ? "Deleting…" : "Delete"}
            </button>
          </div>
        )}
      </div>

      {message && !editing && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm font-semibold ${message.kind === "error" ? "text-danger" : "text-ok"}`}>
          {message.text}
        </p>
      )}

      {editing && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface-subtle p-4"
          aria-label={cloze ? "Edit a fill-in-the-blank card" : "Edit a card"}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-q`} className="text-sm font-semibold text-text">
              {cloze ? "Text with its blanks" : "Question"}
            </label>
            <textarea
              id={`${id}-q`}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={3}
              maxLength={cloze ? MAX_CLOZE_TEXT : MAX_CARD_QUESTION}
              className={`${FIELD} ${cloze ? "font-mono" : ""}`}
              autoFocus
            />
          </div>
          {!cloze && (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-a`} className="text-sm font-semibold text-text">Answer</label>
              <textarea id={`${id}-a`} value={answer} onChange={(event) => setAnswer(event.target.value)} rows={3} maxLength={MAX_CARD_ANSWER} className={FIELD} />
            </div>
          )}
          <p className="text-[13px] text-text-muted">
            {cloze
              ? `This text makes ${card.siblingCount} ${card.siblingCount === 1 ? "card" : "cards"}, one per blank, and ${card.siblingCount === 1 ? "it changes" : "they all change"} together. You can reword the text and the hidden words. To add or remove a blank, delete the cards and make them again from the note.`
              : "The card keeps its place in the review schedule: editing the words does not reset it."}
          </p>
          {message?.kind === "error" && (
            <p role="alert" className="text-[13px] font-semibold text-danger">
              {message.text}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending} className={`${BUTTON} bg-accent px-4 text-on-accent hover:bg-accent-hover`}>
              {pending ? "Saving…" : cloze && card.siblingCount > 1 ? "Save all cards" : "Save"}
            </button>
            <button type="button" disabled={pending} onClick={() => setEditing(false)} className={`${BUTTON} border border-border-strong text-text hover:bg-surface`}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
