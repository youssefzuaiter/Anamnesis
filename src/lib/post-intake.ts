// Assignments from a pasted post (ROADMAP item 55): the parts that are not the model. Pure.
//
// A teacher's post (Teams, Google Classroom, an email) is pasted into a box. The assistant, or, with it off, these rules, picks out the sentences that
// set a piece of work and a date; every one is then held to the post (its quoted sentence must be in it) and its date is read from that sentence by code,
// never taken from the model. What is left is a proposal the person edits; nothing is saved until they confirm it.

import { z } from "zod";
import { parseNaturalDate, stripMatches } from "@/lib/natural-date";
import { quotedIn } from "@/lib/syllabus";
import { isoDay } from "@/lib/week-planner";

export const MAX_POST_CHARS = 8000;
export const MAX_ROWS = 20;
const MAX_SENTENCES = 200;
const MAX_SENTENCE_CHARS = 400;

/** A post as text: not a string is empty, line endings are LF, trimmed, and cut at the limit (a bound on the work, not a verdict on the post). */
export function postText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\r\n?/g, "\n").trim().slice(0, MAX_POST_CHARS);
}

export const extractedSchema = z.object({
  items: z
    .array(z.object({ title: z.string().trim().min(1).max(200), quote: z.string().trim().min(1).max(300) }))
    .max(MAX_ROWS),
});
export type ExtractedItem = z.infer<typeof extractedSchema>["items"][number];

const CUE = /\b(due|deadline|submit(?:ted)?|submission|hand(?:ed)? in|exam|midterm|final|quiz|test|project|assignment|homework|report|presentation|lab|essay|paper)\b/i;
const SUBJECT = /^(.*?)(?:\s+(?:is|are|will be|must be|should be|has to be|needs to be|has been|have to be)\b|\s+due\b|\s*[:–—]\s)/i;

const MONTH_NAMES = "january|february|march|april|may|june|july|august|september|october|november|december";
const EXPLICIT_DAY = new RegExp(`\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTH_NAMES})\\b|\\b(?:${MONTH_NAMES})\\s+\\d{1,2}\\b`, "i");
const WEEKDAY_WORDS = /\b(?:next\s+|this\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;

/** A written day and month beats a weekday beside it: "Friday 4 December" is the 4th, not the coming Friday. Other words (tomorrow, next week) go to the shared parser. */
function readDate(text: string, now: Date) {
  return parseNaturalDate(EXPLICIT_DAY.test(text) ? text.replace(WEEKDAY_WORDS, " ") : text, now);
}

function titleOf(sentence: string, matched: string[]): string {
  const subject = SUBJECT.exec(sentence)?.[1] ?? stripMatches(sentence, matched);
  const cleaned = subject.replace(/^(the|a|an|our|your)\s+/i, "").replace(/[\s.,;:!?]+$/, "").trim().slice(0, 120);
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** The sentences that set something and give a date, found by rules alone: the way a post is read when the assistant is off or gives nothing usable. */
export function extractByCode(text: string, now: Date): ExtractedItem[] {
  const out: ExtractedItem[] = [];
  const sentences = text.split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9])/).slice(0, MAX_SENTENCES);
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (sentence.length < 8 || sentence.length > MAX_SENTENCE_CHARS || !CUE.test(sentence)) continue;
    const parsed = readDate(sentence, now);
    if (!parsed.date) continue;
    const title = titleOf(sentence, parsed.matched);
    if (title.length === 0) continue;
    out.push({ title, quote: sentence.slice(0, 300) });
    if (out.length === MAX_ROWS) break;
  }
  return out;
}

export type PostRow = { title: string; dueDate: string | null; quote: string; note: string };

const titleKey = (title: string) => title.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** The items the post backs up: the quote must be in it, the date is read from the quote by code, a title once, at most MAX_ROWS. */
export function buildRows(items: ExtractedItem[], text: string, now: Date): PostRow[] {
  const seen = new Set<string>();
  const rows: PostRow[] = [];
  for (const item of items) {
    const title = item.title.trim().slice(0, 120);
    const key = titleKey(title);
    if (title === "" || seen.has(key) || !quotedIn(item.quote, text)) continue;
    seen.add(key);
    const date = readDate(item.quote, now).date;
    rows.push({ title, dueDate: date ? isoDay(date) : null, quote: item.quote.trim(), note: `From a pasted post: “${item.quote.trim()}”` });
    if (rows.length === MAX_ROWS) break;
  }
  return rows;
}

export type CourseRef = { id: string; code: string; title: string };

/** The course a post names by its code (case and a space between letters and digits do not matter), only when exactly one of the person's courses is named. */
export function detectCourse(text: string, courses: CourseRef[]): string | null {
  const found = new Set<string>();
  for (const course of courses) {
    const m = /^([A-Za-z]+)\s*(\d+[A-Za-z]*)$/.exec(course.code.trim());
    const pattern = m ? `${m[1]}\\s?${m[2]}` : course.code.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (pattern === "") continue;
    if (new RegExp(`(?<![A-Za-z0-9])${pattern}(?![A-Za-z0-9])`, "i").test(text)) found.add(course.id);
  }
  return found.size === 1 ? [...found][0] : null;
}

/** Marks the rows the person already has an open task for (same title, same day); those start unticked. */
export function markDuplicates(rows: PostRow[], existing: { title: string; dueDate: string | null }[]): (PostRow & { existing: boolean })[] {
  const have = new Set(existing.map((e) => `${titleKey(e.title)}|${e.dueDate ?? ""}`));
  return rows.map((row) => ({ ...row, existing: have.has(`${titleKey(row.title)}|${row.dueDate ?? ""}`) }));
}

function realDay(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

/** Strict: a stray key (a `userId`, a `priority`) is a rejected request, not an ignored one. */
export const confirmRowsSchema = z
  .array(
    z
      .object({
        title: z.string().trim().min(1).max(120),
        dueDate: z.string().refine(realDay).nullable(),
        courseId: z.uuid().nullable(),
        note: z.string().max(500),
      })
      .strict(),
  )
  .min(1)
  .max(MAX_ROWS);
export type ConfirmRow = z.infer<typeof confirmRowsSchema>[number];
