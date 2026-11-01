"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type SyntheticEvent,
} from "react";
import { createCardAction } from "@/actions/flashcards";
import {
  MAX_CLOZE_TEXT,
  clozeFromSelection,
  clozeNumbers,
  renderCloze,
  validateCloze,
} from "@/lib/cloze";
import { MAX_CARD_ANSWER, MAX_CARD_QUESTION } from "@/lib/domain";

type Kind = "cloze" | "basic";

/** Words selected in the note, and the one block of text they sit in. */
type Selection = { text: string; context: string };

/** Where a block of text ends, for finding the sentence a selection sits in. */
const BLOCKS = "p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, dd, dt, pre";

const FIELD =
  "w-full rounded-lg border border-control bg-surface px-3 py-2.5 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none";
const OUTLINE_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-border-strong px-3.5 text-sm font-semibold text-text transition-colors hover:bg-surface-subtle disabled:opacity-60 sm:min-h-9";

/**
 * The text of a piece of the page as a person would copy it. KaTeX draws a formula twice,
 * once as MathML for screen readers and once as boxes, so a plain copy of it reads doubled;
 * a formula becomes its own `$...$` source instead, which is what the note holds.
 */
function plainText(node: Node): string {
  const copy = node.cloneNode(true) as Element | DocumentFragment;
  for (const formula of Array.from(copy.querySelectorAll(".katex"))) {
    const tex = formula.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    if (tex) formula.replaceWith(`$${tex}$`);
    else formula.querySelectorAll(".katex-mathml").forEach((mathml) => mathml.remove());
  }
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * What is selected, if it is text of the note itself. A selection that starts anywhere else
 * (the title, the side rail, the editor) is not offered a card. One that starts in the note
 * and stops at the very start of whatever follows it, as a triple-click on the last
 * paragraph does, still counts, cut off at the end of the note.
 */
function readSelection(): Selection | null {
  const selection = window.getSelection();
  const body = document.querySelector("[data-note-body]");
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !body) return null;

  const range = selection.getRangeAt(0).cloneRange();
  if (!body.contains(range.startContainer)) return null;
  if (!body.contains(range.endContainer)) {
    if (range.endOffset !== 0) return null;
    range.setEnd(body, body.childNodes.length);
  }

  const text = plainText(range.cloneContents());
  if (text === "") return null;

  const start = range.startContainer;
  const block = (start instanceof Element ? start : start.parentElement)?.closest(BLOCKS);
  const context = block && body.contains(block) ? plainText(block) : text;
  return { text, context };
}

const sameSelection = (a: Selection | null, b: Selection | null) =>
  a === b || (a !== null && b !== null && a.text === b.text && a.context === b.context);

const plural = (n: number) => `${n} ${n === 1 ? "card" : "cards"}`;

/**
 * Makes cards for one note: by hand, or from words selected in the note. A tray appears
 * while something in the note is selected; both it and the New card button open the same
 * editor, in a native dialog, so focus trapping and Escape come from the browser. The
 * server is only ever sent what the person finally submitted, never the selection itself.
 */
export function CardMaker({ noteId }: { noteId: string }) {
  const titleId = useId();
  const helpId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const busy = useRef(false);
  const [pending, startTransition] = useTransition();

  const [selection, setSelection] = useState<Selection | null>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("cloze");
  const [text, setText] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [hasSelection, setHasSelection] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setSelection((current) => {
      const next = readSelection();
      return sameSelection(current, next) ? current : next;
    });
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);

  function openEditor(nextKind: Kind) {
    // Read again rather than trust the last change: a keyboard user may have selected
    // and tabbed here without another change event.
    const from = readSelection() ?? selection;
    setStatus("");
    setError(null);
    setKind(nextKind);
    setText(from && nextKind === "cloze" ? (clozeFromSelection(from.context, from.text) ?? from.text.slice(0, 400)) : "");
    setQuestion("");
    setAnswer(from && nextKind === "basic" ? from.text.slice(0, MAX_CARD_ANSWER) : "");
    setHasSelection(false);
    setOpen(true);
    dialogRef.current?.showModal();
    requestAnimationFrame(() => (nextKind === "cloze" ? textRef : questionRef).current?.focus());
  }

  function reset() {
    setOpen(false);
    setKind("cloze");
    setText("");
    setQuestion("");
    setAnswer("");
    setError(null);
  }

  const check = kind === "cloze" ? validateCloze(text) : null;
  const cards = check?.ok ? check.numbers : [];
  const canAdd =
    !pending && (kind === "cloze" ? check?.ok === true : question.trim() !== "" && answer.trim() !== "");
  const addLabel = pending ? "Adding…" : cards.length > 1 ? `Add ${cards.length} cards` : "Add card";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current || !canAdd) return;
    busy.current = true;
    setError(null);
    startTransition(async () => {
      const result = await createCardAction(
        noteId,
        kind === "cloze" ? { kind, text } : { kind, question, answer },
      );
      busy.current = false;
      if (!result.success) {
        setError(result.error.message);
        return;
      }
      setStatus(`Added ${plural(result.data.created)}.`);
      dialogRef.current?.close();
      window.getSelection()?.removeAllRanges();
      setSelection(null);
    });
  }

  function syncTextSelection(event: SyntheticEvent<HTMLTextAreaElement>) {
    const area = event.currentTarget;
    setHasSelection(area.selectionStart !== area.selectionEnd);
  }

  function hideSelectedWords() {
    const area = textRef.current;
    if (!area || area.selectionStart === area.selectionEnd) return;
    const next = Math.max(0, ...clozeNumbers(text)) + 1;
    if (next > 99) return;
    const { selectionStart: from, selectionEnd: to } = area;
    // Edit the field itself, so the caret lands after the inserted text at once; React is
    // then given the value the field already holds and has nothing to move.
    area.setRangeText(`{{c${next}::${text.slice(from, to)}}}`, from, to, "end");
    setText(area.value);
    setHasSelection(false);
  }

  // A button that opens the editor must not take the selection with it.
  const keepSelection = (event: SyntheticEvent) => event.preventDefault();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onMouseDown={keepSelection}
          onClick={() => openEditor("cloze")}
          className={OUTLINE_BUTTON}
        >
          New card
        </button>
        <p role="status" className="text-xs text-text-muted">
          {status}
        </p>
      </div>

      {selection && !open && (
        <div
          role="group"
          aria-label="Make a card from the selection"
          className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-4 right-[5.5rem] z-20 flex flex-wrap items-center gap-2 rounded-xl border border-border-subtle bg-surface p-2 shadow-card sm:bottom-6 sm:left-1/2 sm:right-auto sm:-translate-x-1/2"
        >
          <button
            type="button"
            onMouseDown={keepSelection}
            onClick={() => openEditor("cloze")}
            className={OUTLINE_BUTTON}
          >
            Fill in the blank
          </button>
          <button
            type="button"
            onMouseDown={keepSelection}
            onClick={() => openEditor("basic")}
            className={OUTLINE_BUTTON}
          >
            Question and answer
          </button>
        </div>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={reset}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto rounded-2xl bg-surface p-5 text-text backdrop:bg-black/50"
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          <h2 id={titleId} className="text-base font-bold">
            New card
          </h2>

          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-1 text-xs font-semibold text-text-muted">Kind of card</legend>
            {(
              [
                ["cloze", "Fill in the blank"],
                ["basic", "Question and answer"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-control px-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
              >
                <input
                  type="radio"
                  name="kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                  className="accent-[var(--accent)]"
                />
                {label}
              </label>
            ))}
          </fieldset>

          {kind === "cloze" ? (
            <div className="flex flex-col gap-2">
              <label htmlFor={`${titleId}-text`} className="text-xs font-semibold text-text-muted">
                Text with blanks
              </label>
              <textarea
                id={`${titleId}-text`}
                ref={textRef}
                value={text}
                rows={4}
                maxLength={MAX_CLOZE_TEXT}
                aria-describedby={helpId}
                onChange={(event) => {
                  setText(event.target.value);
                  syncTextSelection(event);
                }}
                onSelect={syncTextSelection}
                onKeyUp={syncTextSelection}
                onMouseUp={syncTextSelection}
                className={`${FIELD} min-h-11 resize-y`}
              />
              <div>
                <button
                  type="button"
                  disabled={!hasSelection}
                  onMouseDown={keepSelection}
                  onClick={hideSelectedWords}
                  className={OUTLINE_BUTTON}
                >
                  Hide selected words
                </button>
              </div>
              <div id={helpId} className="text-xs text-text-muted">
                {text.trim() === "" ? (
                  <p>
                    Select words and press “Hide selected words”, or write {"{{c1::the answer}}"} around them.
                    Use c2, c3 for more cards from one text, and {"{{c1::answer::hint}}"} to show a hint.
                  </p>
                ) : check?.ok ? (
                  <>
                    <p>This makes {plural(cards.length)}.</p>
                    <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                      {cards.map((n) => (
                        <li key={n}>
                          {renderCloze(check.text, n).front.map((piece, index) => (
                            <span key={index} className={piece.role === "blank" ? "font-semibold" : undefined}>
                              {piece.role === "blank" ? `[${piece.text}]` : piece.text}
                            </span>
                          ))}
                        </li>
                      ))}
                    </ol>
                  </>
                ) : (
                  <p>{check?.message}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${titleId}-q`} className="text-xs font-semibold text-text-muted">
                  Question
                </label>
                <textarea
                  id={`${titleId}-q`}
                  ref={questionRef}
                  value={question}
                  rows={2}
                  maxLength={MAX_CARD_QUESTION}
                  onChange={(event) => setQuestion(event.target.value)}
                  className={`${FIELD} min-h-11 resize-y`}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${titleId}-a`} className="text-xs font-semibold text-text-muted">
                  Answer
                </label>
                <textarea
                  id={`${titleId}-a`}
                  value={answer}
                  rows={3}
                  maxLength={MAX_CARD_ANSWER}
                  onChange={(event) => setAnswer(event.target.value)}
                  className={`${FIELD} min-h-11 resize-y`}
                />
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => dialogRef.current?.close()} className={OUTLINE_BUTTON}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canAdd}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-60 sm:min-h-9"
            >
              {addLabel}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
