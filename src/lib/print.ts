/**
 * A course's printable notes (ROADMAP item 34). A print is one document, so it is
 * bounded: each note is rendered on the server (maths, code) and a 100-note course
 * of long notes would otherwise make one very slow request. The page says when it
 * shows fewer than the course holds.
 */
export const PRINT_NOTE_LIMIT = 100;

/** The notes to show and how many were left out, from one fetch of limit + 1. */
export function splitPrintable<T>(fetched: T[], limit: number = PRINT_NOTE_LIMIT): { shown: T[]; leftOut: boolean } {
  return { shown: fetched.slice(0, limit), leftOut: fetched.length > limit };
}
