// The letter-to-points table the GPA is worked out with. Pure data and validation,
// no React and no Prisma, so the stored JSON can be checked wherever it is read.

export type GradeScale = { letter: string; points: number }[];

export const MAX_SCALE_ENTRIES = 20;
export const MAX_POINTS = 10;

/**
 * A common Turkish 4.0 scheme, offered as a starting point only: the person is told
 * to check it against their own university's table.
 */
export const DEFAULT_GRADE_SCALE: GradeScale = [
  { letter: "AA", points: 4 },
  { letter: "BA", points: 3.5 },
  { letter: "BB", points: 3 },
  { letter: "CB", points: 2.5 },
  { letter: "CC", points: 2 },
  { letter: "DC", points: 1.5 },
  { letter: "DD", points: 1 },
  { letter: "FD", points: 0.5 },
  { letter: "FF", points: 0 },
];

const LETTER = /^[A-Za-z0-9+-]{1,4}$/;

/** Trimmed and upper-cased, or null if it is not one to four letters, digits, `+` or `-`. */
export function normaliseLetter(raw: string): string | null {
  const trimmed = raw.trim();
  return LETTER.test(trimmed) ? trimmed.toUpperCase() : null;
}

export type ScaleCheck = { ok: true; scale: GradeScale } | { ok: false; message: string };

const fail = (message: string): ScaleCheck => ({ ok: false, message });

/**
 * Checks a scale that came from the browser or from the database. The result is a
 * fresh, normalised copy sorted by points, highest first (ties by letter), so the
 * input is never trusted beyond its two known keys.
 */
export function validateScale(input: unknown): ScaleCheck {
  if (!Array.isArray(input)) return fail("The scale must be a list of letters and points.");
  if (input.length === 0) return fail("Give the scale at least one letter.");
  if (input.length > MAX_SCALE_ENTRIES) {
    return fail(`A scale can have at most ${MAX_SCALE_ENTRIES} letters.`);
  }

  const seen = new Set<string>();
  const scale: GradeScale = [];
  for (const entry of input) {
    if (typeof entry !== "object" || entry === null) {
      return fail("Each entry needs a letter and its points.");
    }
    const { letter, points } = entry as Record<string, unknown>;
    if (typeof letter !== "string") return fail("Each letter must be text.");
    const normalised = normaliseLetter(letter);
    if (normalised === null) {
      return fail("A letter is one to four letters, digits, + or -.");
    }
    if (seen.has(normalised)) return fail(`${normalised} appears twice.`);
    seen.add(normalised);
    if (typeof points !== "number" || !Number.isFinite(points)) {
      return fail(`The points for ${normalised} must be a number.`);
    }
    if (points < 0 || points > MAX_POINTS) {
      return fail(`The points for ${normalised} must be between 0 and ${MAX_POINTS}.`);
    }
    scale.push({ letter: normalised, points: Math.round(points * 100) / 100 });
  }

  scale.sort((a, b) => b.points - a.points || (a.letter < b.letter ? -1 : 1));
  return { ok: true, scale };
}

/** A stored scale that is missing or unusable is the preset, never an error. */
export function scaleOrDefault(stored: unknown): GradeScale {
  const result = validateScale(stored);
  return result.ok ? result.scale : DEFAULT_GRADE_SCALE.map((entry) => ({ ...entry }));
}

/** The same letters with the same points, whatever the order. */
export function sameScale(a: GradeScale, b: GradeScale): boolean {
  return (
    a.length === b.length &&
    a.every((entry) => b.some((other) => other.letter === entry.letter && other.points === entry.points))
  );
}

export function maxPoints(scale: GradeScale): number {
  return scale.reduce((top, entry) => Math.max(top, entry.points), 0);
}
