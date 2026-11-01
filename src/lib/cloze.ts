// Fill-in-the-blank cards. A text hides parts of itself with Anki's syntax,
// `{{c1::answer}}` or `{{c1::answer::hint}}`; every distinct number is one card.
// Pure text logic: no React, no Prisma, no DOM, so it can be checked in isolation and
// run on the server and in the browser alike.

export const MAX_CLOZE_TEXT = 2000;
export const MAX_CLOZE_CARDS = 10;

/** A sentence over this length is cut down to the selection and a little around it. */
const LONG_SENTENCE = 400;
const CONTEXT_EACH_SIDE = 120;

export type ClozePart =
  | { kind: "text"; text: string }
  | { kind: "cloze"; n: number; answer: string; hint: string | null };

export type ClozePiece = { text: string; role: "plain" | "blank" | "answer" };

/** Reads `[1-9][0-9]?` followed by `::` from `from`; the body of the deletion starts after it. */
function readHeader(text: string, from: number): { n: number; bodyStart: number } | null {
  const first = text.charCodeAt(from);
  if (!(first >= 49 && first <= 57)) return null; // 1 to 9: no 0, so no leading zero
  let digits = 1;
  const second = text.charCodeAt(from + 1);
  if (second >= 48 && second <= 57) digits = 2;
  if (text[from + digits] !== ":" || text[from + digits + 1] !== ":") return null;
  return { n: Number(text.slice(from, from + digits)), bodyStart: from + digits + 2 };
}

/**
 * Splits a text into plain text and deletions. Linear in the length of the text, however
 * hostile: the next `}}` and the next `{{` are each searched for from a position that only
 * moves forward, and "there is none" is remembered, so a text of 100,000 openers is read
 * once rather than once per opener.
 *
 * A deletion's body cannot contain `{{`, so an opener followed by another opener before any
 * `}}` is not a deletion; it, like an opener with a bad number or no closer, stays text.
 */
export function parseCloze(text: string): ClozePart[] {
  const parts: ClozePart[] = [];
  const pushText = (value: string) => {
    if (value === "") return;
    const last = parts[parts.length - 1];
    if (last?.kind === "text") last.text += value;
    else parts.push({ kind: "text", text: value });
  };

  let cursor = 0; // where scanning resumes
  let textFrom = 0; // start of the plain text not yet pushed
  let closeAt = -2; // first `}}` at or after the last body start; -2 unknown, -1 none
  let openAt = -2; // first `{{` at or after the last body start

  while (cursor < text.length) {
    const start = text.indexOf("{{c", cursor);
    if (start === -1) break;

    const header = readHeader(text, start + 3);
    if (!header) {
      cursor = start + 2;
      continue;
    }

    if (closeAt !== -1 && closeAt < header.bodyStart) closeAt = text.indexOf("}}", header.bodyStart);
    if (closeAt === -1) break; // no closer anywhere ahead: nothing later can be a deletion
    if (openAt !== -1 && openAt < header.bodyStart) openAt = text.indexOf("{{", header.bodyStart);
    if (openAt !== -1 && openAt < closeAt) {
      cursor = start + 2;
      continue;
    }

    const body = text.slice(header.bodyStart, closeAt);
    const split = body.indexOf("::");
    const answer = split === -1 ? body : body.slice(0, split);
    const hint = split === -1 ? "" : body.slice(split + 2);

    pushText(text.slice(textFrom, start));
    parts.push({ kind: "cloze", n: header.n, answer, hint: hint === "" ? null : hint });
    cursor = closeAt + 2;
    textFrom = cursor;
  }

  pushText(text.slice(textFrom));
  return parts;
}

/** Each number used, once, smallest first. */
export function clozeNumbers(text: string): number[] {
  const numbers = new Set<number>();
  for (const part of parseCloze(text)) {
    if (part.kind === "cloze") numbers.add(part.n);
  }
  return [...numbers].sort((a, b) => a - b);
}

function pushPiece(pieces: ClozePiece[], piece: ClozePiece) {
  const last = pieces[pieces.length - 1];
  if (piece.role === "plain" && last?.role === "plain") last.text += piece.text;
  else pieces.push({ ...piece });
}

/**
 * The two faces of the card for number `n`: on the front that group is blank (or shows
 * its hint) and the other groups are shown as ordinary text; on the back the group's
 * text is marked as the answer.
 */
export function renderCloze(text: string, n: number): { front: ClozePiece[]; back: ClozePiece[] } {
  const front: ClozePiece[] = [];
  const back: ClozePiece[] = [];
  for (const part of parseCloze(text)) {
    if (part.kind === "text") {
      pushPiece(front, { text: part.text, role: "plain" });
      pushPiece(back, { text: part.text, role: "plain" });
    } else if (part.n === n) {
      pushPiece(front, { text: part.hint ?? "…", role: "blank" });
      pushPiece(back, { text: part.answer, role: "answer" });
    } else {
      pushPiece(front, { text: part.answer, role: "plain" });
      pushPiece(back, { text: part.answer, role: "plain" });
    }
  }
  return { front, back };
}

/** What group `n` hides, for the stored answer: its answers joined with a comma. */
export function answerFor(text: string, n: number): string {
  return parseCloze(text)
    .flatMap((part) => (part.kind === "cloze" && part.n === n ? [part.answer.trim()] : []))
    .join(", ");
}

export type ClozeCheck =
  | { ok: true; text: string; numbers: number[] }
  | { ok: false; message: string };

const fail = (message: string): ClozeCheck => ({ ok: false, message });

/** Checks a text that came from the browser before it makes any card. */
export function validateCloze(input: string): ClozeCheck {
  const text = input.trim();
  if (text === "") return fail("Write the text first.");
  if (text.length > MAX_CLOZE_TEXT) return fail(`The text can be at most ${MAX_CLOZE_TEXT} characters.`);

  const parts = parseCloze(text);
  const plain = parts.map((part) => (part.kind === "text" ? part.text : "")).join("");
  if (plain.includes("{{") || plain.includes("}}")) {
    return fail("Write each hidden part as {{c1::answer}} or {{c1::answer::hint}}. Check for a missing }} or a stray {{.");
  }

  const deletions = parts.filter((part) => part.kind === "cloze");
  if (deletions.length === 0) return fail("Hide at least one part with {{c1::...}}.");
  if (deletions.some((part) => part.answer.trim() === "")) return fail("A hidden part is empty.");

  const numbers = clozeNumbers(text);
  if (numbers.length > MAX_CLOZE_CARDS) {
    return fail(`A text can make at most ${MAX_CLOZE_CARDS} cards. Use fewer different numbers.`);
  }
  return { ok: true, text, numbers };
}

// `{{` and `}}` already in a note would read as markers; a space between them makes them text.
const neutralise = (value: string) => value.replace(/\{(?=\{)/g, "{ ").replace(/\}(?=\})/g, "} ");
const collapse = (value: string) => value.replace(/\s+/g, " ").trim();
const isTerminal = (char: string) => char === "." || char === "!" || char === "?";

/**
 * A fill-in-the-blank text from words selected in a note: the sentence around the
 * selection (`context` is the one block of text it sits in), with the selection hidden.
 * Null when there is nothing to hide or the result would be too long for a card.
 */
export function clozeFromSelection(context: string, selected: string): string | null {
  const selection = collapse(neutralise(selected));
  if (selection === "") return null;
  const text = collapse(neutralise(context));

  const at = text.indexOf(selection);
  if (at === -1) return null;
  const end = at + selection.length;

  let from = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (isTerminal(text[i]) && text[i + 1] === " ") {
      from = i + 2;
      break;
    }
  }
  let to = text.length;
  for (let i = end - 1; i < text.length; i++) {
    if (isTerminal(text[i]) && (i + 1 === text.length || text[i + 1] === " ")) {
      to = i + 1;
      break;
    }
  }

  if (to - from > LONG_SENTENCE) {
    from = at;
    if (at - CONTEXT_EACH_SIDE > 0) {
      const space = text.indexOf(" ", at - CONTEXT_EACH_SIDE);
      if (space !== -1 && space < at) from = space + 1;
    } else {
      from = 0;
    }
    to = end;
    if (end + CONTEXT_EACH_SIDE < text.length) {
      const space = text.lastIndexOf(" ", end + CONTEXT_EACH_SIDE);
      if (space > end) to = space;
    } else {
      to = text.length;
    }
  }

  const result = `${text.slice(from, at)}{{c1::${selection}}}${text.slice(end, to)}`;
  return result.length > MAX_CLOZE_TEXT ? null : result;
}

/**
 * One review session shows one card from each fill-in-the-blank text: the front of the
 * second would show the answer to the first. The others stay due for the next session.
 * Cards of one text share a note and a question; basic cards are never held back.
 */
export function spreadSiblings<
  T extends { id: string; noteId: string | null; question: string; clozeIndex: number | null },
>(cards: T[]): { session: T[]; held: number } {
  const seen = new Set<string>();
  const session: T[] = [];
  for (const card of cards) {
    if (card.clozeIndex !== null) {
      const key = `${card.noteId ?? "\u0000"}|${card.question}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    session.push(card);
  }
  return { session, held: cards.length - session.length };
}
