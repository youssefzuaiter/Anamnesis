// The rules of the assistant's two edits (ROADMAP 23), pure: no model, no database.
//
// The model only names a target and, for an append, the words; everything that decides what is
// written is here or in the services, the same split the capture parser makes for dates.

import type { ParsedDate } from "@/lib/natural-date";
import { MAX_NOTE_LENGTH } from "@/lib/see-also";

/** The most an append adds in one go. */
export const MAX_APPEND = 10_000;

/**
 * True when the request points back at the conversation ("append this summary", "add that", "your
 * answer", "the above"), so the text is the thread's last answer, verbatim: a 3B model asked to copy
 * it would paraphrase or cut it.
 */
export function refersBack(question: string): boolean {
  return /\b(append|add|save|put|copy|paste)\s+(this|that|it|these|those|the\s+(summary|answer|above|list|explanation)|your\s+(answer|summary|reply)|the\s+last\s+(answer|reply))\b/i.test(
    question,
  ) || /\b(the\s+above|above\s+(summary|answer|text))\b/i.test(question);
}

/** The note's text with `text` added as a new paragraph, or null when the note would pass the limit. */
export function appendedContent(content: string, text: string): string | null {
  const addition = text.trim();
  const base = content.replace(/\s+$/, "");
  const next = base ? `${base}\n\n${addition}` : addition;
  return next.length > MAX_NOTE_LENGTH ? null : next;
}

/**
 * The new due date from the person's words: the time they gave, else the old due date's time of
 * day, else the end of the day (the rule for a date entered as a day). Null when they named no date.
 */
export function rescheduledDue(oldDue: Date | null, when: ParsedDate): Date | null {
  if (!when.date) return null;
  if (when.hasTime) return when.date;
  const day = when.date;
  if (oldDue) return new Date(day.getFullYear(), day.getMonth(), day.getDate(), oldDue.getHours(), oldDue.getMinutes(), oldDue.getSeconds(), oldDue.getMilliseconds());
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);
}

/** How a title is compared: case and runs of spaces folded, nothing else. */
export function titleKey(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

/** A title as a model tends to word it, "my reading list note", made plain: "reading list". */
export function plainTitle(title: string): string {
  let plain = title.trim();
  for (let i = 0; i < 3; i++) plain = plain.replace(/^(my|the|a|an)\s+/i, "").replace(/\s+(note|task)$/i, "").trim();
  return plain;
}

/**
 * The rows whose title the request itself contains as whole words, the longest such title only:
 * the fallback when the model names no target, or one that matches nothing.
 */
export function titlesInRequest<T extends { title: string }>(question: string, rows: T[]): T[] {
  const text = ` ${titleKey(question).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  const words = (title: string) => titleKey(title).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const found = rows.filter((row) => words(row.title) !== "" && text.includes(` ${words(row.title)} `));
  const longest = Math.max(0, ...found.map((row) => words(row.title).length));
  return found.filter((row) => words(row.title).length === longest);
}

