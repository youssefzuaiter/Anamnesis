// What a note's text may be when it arrives from a form. Pure, no Prisma and no React.

import { z } from "zod";
import { MAX_NOTE_LENGTH } from "@/lib/see-also";

/**
 * Every line break as a single LF. A browser sends the line breaks of a textarea as
 * CR LF, so a note of 99,000 characters with 4,130 line breaks arrives as 103,130 and a
 * limit applied to what arrives refuses it, with no sign on the page that anything
 * was wrong. Notes are therefore judged and stored in the form the person typed.
 * One non-backtracking pass: linear in the text.
 */
export function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

const TOO_LONG = `A note can hold at most ${MAX_NOTE_LENGTH.toLocaleString("en-US")} characters; a line break counts as one.`;

/**
 * The text of a note from a form: line breaks made LF, then at most `MAX_NOTE_LENGTH`.
 * Normalising shrinks text by at most half (every CR LF becomes one character), so
 * anything over twice the limit cannot become valid and is refused on its length alone,
 * before any rewriting: the server-action body limit is 15 MB.
 */
export const noteContent = z
  .string()
  .max(MAX_NOTE_LENGTH * 2, TOO_LONG)
  .transform(normalizeLineBreaks)
  .pipe(z.string().max(MAX_NOTE_LENGTH, TOO_LONG));
