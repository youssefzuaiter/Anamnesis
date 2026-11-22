// Syllabus to assessments (ROADMAP item 50): the parts that are not the model. Pure.
//
// The model reads a note in sections and lists what looks like an assessment, each with the line it came from. Everything it says is then
// held to the note: a row stays only if its quoted line is in the note, a weight stays only if that number is in the quote, a date stays only if
// it is written as a day and a month. What is left is a proposal the person edits; nothing is saved until they confirm it.

import { z } from "zod";
import { groundedness } from "@/lib/quiz";

/** A proposal and an add are at most this many rows. */
export const MAX_ROWS = 30;
/** The note is read in at most this many sections (about 36,000 characters), a syllabus being short. */
export const MAX_SYLLABUS_SECTIONS = 6;
/** A model quote that is not in the note word for word still counts if this much of it is made of the note's words. */
const QUOTE_FLOOR = 0.85;
const MAX_DATE_TEXT = 300;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function realDay(year: number, month: number, day: number): boolean {
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

// --- What the model may return ---------------------------------------------------------------------------------

export const extractedSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        weight: z.number().nullable(),
        quote: z.string().trim().min(1).max(300),
      }),
    )
    .max(20),
});
export type ExtractedItem = z.infer<typeof extractedSchema>["items"][number];

// --- Terms and dates -------------------------------------------------------------------------------------------

export function termYear(term: string): { year: number; autumn: boolean } | null {
  const year = /\b(20\d{2})\b/.exec(term);
  if (!year) return null;
  return { year: Number(year[1]), autumn: /\b(fall|autumn|güz|guz)\b/i.test(term) };
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const MONTH_NAMES = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_NAMES})\\b\\.?(?:,?\\s+(20\\d{2})\\b)?`, "i");
const MONTH_DAY = new RegExp(`\\b(${MONTH_NAMES})\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(20\\d{2})\\b)?`, "i");
const ISO_IN_TEXT = /\b(20\d{2})-(\d{2})-(\d{2})\b/;

/**
 * A date as `yyyy-mm-dd`, only when the text names a day and a month (or is ISO). Without a year it is the term's year, and January to March of an
 * autumn term is the year after; with no term year it is this year. "Week 7", "tomorrow" and "set by the registrar" are not dates here: the person sets those.
 */
export function resolveDate(text: string | null, term: { year: number; autumn: boolean } | null, now: Date): string | null {
  if (!text || text.length > MAX_DATE_TEXT) return null;
  let year: number | null = null;
  let month: number;
  let day: number;

  const iso = ISO_IN_TEXT.exec(text);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    const dm = DAY_MONTH.exec(text);
    const md = dm ? null : MONTH_DAY.exec(text);
    if (dm) {
      day = Number(dm[1]);
      month = MONTHS[dm[2].toLowerCase()];
      year = dm[3] ? Number(dm[3]) : null;
    } else if (md) {
      month = MONTHS[md[1].toLowerCase()];
      day = Number(md[2]);
      year = md[3] ? Number(md[3]) : null;
    } else {
      return null;
    }
  }
  if (year === null) year = term ? (term.autumn && month <= 3 ? term.year + 1 : term.year) : now.getFullYear();
  if (!realDay(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The end of that local day, as the course page stores a due date. */
export function endOfLocalDay(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

// --- Holding the model to the note -----------------------------------------------------------------------------

/** The weight if its number is written in the quoted line as a number of its own (30 is not the 3 of 30 or the 30 of 130). */
export function weightInQuote(weight: number | null, quote: string): number | null {
  if (weight === null || !Number.isFinite(weight) || weight < 0 || weight > 100) return null;
  for (const match of quote.matchAll(/(?<![\d.])(\d{1,3}(?:\.\d+)?)(?!\d)/g)) {
    if (Number(match[1]) === weight) return weight;
  }
  return null;
}

/** Case, spacing and the marks of a Markdown table or emphasis do not make a quote differ from the note. */
function fold(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[*_|>`#~]/g, " ").replace(/\s+/g, " ").trim();
}

export function quotedIn(quote: string, section: string): boolean {
  const folded = fold(quote);
  if (folded === "") return false;
  return fold(section).includes(folded) || groundedness(quote, section) >= QUOTE_FLOOR;
}

export type SyllabusRow = { title: string; weight: number | null; dueDate: string | null; quote: string };

/**
 * The model's items that the note backs up. The weight stays only if its number is in the quoted line, and the date is read from the quoted line
 * itself, never from anything the model says about it: an invented date has nowhere to come from.
 */
export function buildRows(items: ExtractedItem[], section: string, term: { year: number; autumn: boolean } | null, now: Date): SyllabusRow[] {
  const rows: SyllabusRow[] = [];
  for (const item of items) {
    if (!quotedIn(item.quote, section)) continue;
    rows.push({ title: item.title.trim(), weight: weightInQuote(item.weight, item.quote), dueDate: resolveDate(item.quote, term, now), quote: item.quote.trim() });
  }
  return rows;
}

const titleKey = (title: string) => title.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** The sections' rows in the note's order, a title once (the first), at most MAX_ROWS. */
export function mergeRows(groups: SyllabusRow[][]): SyllabusRow[] {
  const seen = new Set<string>();
  const out: SyllabusRow[] = [];
  for (const row of groups.flat()) {
    const key = titleKey(row.title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length === MAX_ROWS) break;
  }
  return out;
}

/** Marks the rows whose title the course already has an assessment for; those start unticked. */
export function markExisting(rows: SyllabusRow[], existingTitles: string[]): (SyllabusRow & { existing: boolean })[] {
  const have = new Set(existingTitles.map(titleKey));
  return rows.map((row) => ({ ...row, existing: have.has(titleKey(row.title)) }));
}

export function totalWeight(rows: { weight: number | null; on: boolean }[]): number {
  return rows.reduce((sum, row) => (row.on && row.weight !== null ? sum + row.weight : sum), 0);
}

// --- What the browser sends to add -----------------------------------------------------------------------------

/** Strict: a stray key (a `userId`, a `score`) is a rejected request, not an ignored one. */
export const confirmRowsSchema = z
  .array(
    z
      .object({
        title: z.string().trim().min(1).max(120),
        weight: z.number().min(0).max(100),
        dueDate: z
          .string()
          .refine((value) => {
            const m = ISO_DAY.exec(value);
            return m !== null && realDay(Number(m[1]), Number(m[2]), Number(m[3]));
          })
          .nullable(),
      })
      .strict(),
  )
  .min(1)
  .max(MAX_ROWS);
export type ConfirmRow = z.infer<typeof confirmRowsSchema>[number];
