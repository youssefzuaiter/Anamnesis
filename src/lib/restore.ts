// Reading an Anamnesis JSON export back in (ROADMAP item 35). Pure: no Prisma, no React, so every rule
// is tested without a database. The file is hostile data: nothing in it is an owner, a derived value
// or an id that is stored. A row keeps only the fields below, checked as the app's own forms check them;
// an id is read only as an opaque key that lets one row in the file point at another.

import { z } from "zod";
import { EXPORT_FORMAT_VERSION } from "@/lib/export-shape";
import { PROJECT_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES, MAX_CARD_ANSWER, MAX_CARD_QUESTION } from "@/lib/domain";
import { noteContent } from "@/lib/note-text";
import { normalizeTitle } from "@/lib/wiki-links";

/** The most a restore reads (one upload) and does in one run. Every number is a judgement, not a measured limit. */
export const RESTORE_LIMITS = {
  /** The body of the upload. A large export (150 MB measured in the export work) is restored by its parts. */
  maxBytes: 100 * 1024 * 1024,
  /** Rows read per table; the rest are counted and left. */
  maxRows: 20_000,
  /** Notes created per run: each is indexed and its links resolved, as a save is. A second run carries on. */
  notesPerRun: 200,
  /** Reports list at most this many names. */
  listCap: 100,
} as const;

export const MAX_TAGS = 12;
const OPAQUE_ID = z.string().min(1).max(100);

const emptyToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);

/**
 * An ISO date string in UTC, as the export writes them (`2026-11-20T09:00:00.000Z`), within a sane range, as a Date.
 * An impossible calendar date (30 February, which JavaScript quietly moves to March, so the month no longer matches) fails the row, as any other
 * date that is not exactly what it says.
 */
const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/;
const date = z
  .string()
  .max(40)
  .transform((text, ctx) => {
    const match = ISO_UTC.exec(text);
    const parsed = new Date(text);
    const year = parsed.getUTCFullYear();
    const exact =
      match !== null &&
      !Number.isNaN(parsed.getTime()) &&
      parsed.getUTCFullYear() === Number(match[1]) &&
      parsed.getUTCMonth() + 1 === Number(match[2]);
    if (!exact || year < 1900 || year > 2200) {
      ctx.addIssue({ code: "custom", message: "not a date" });
      return z.NEVER;
    }
    return parsed;
  });
const optionalDate = z.preprocess(emptyToNull, date.nullish().transform((value) => value ?? null));
const optionalText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullish().transform((value) => value ?? null));
const title = (max: number) => z.string().trim().min(1).max(max);
/** A reference to another row of the file, by its old id. Never stored. */
const refId = z.preprocess(emptyToNull, OPAQUE_ID.nullish().transform((value) => value ?? null)).catch(null);
const tags = z
  .array(z.string())
  .catch([])
  .transform((list) => [...new Set(list.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag !== "" && tag.length <= 50))].slice(0, MAX_TAGS));

const id = OPAQUE_ID.optional().catch(undefined);

export const rowSchemas = {
  courses: z.object({
    id,
    code: title(20),
    title: title(160),
    term: title(60),
    credits: z.number().min(0).max(100).nullish().transform((value) => value ?? null),
    finalGrade: optionalText(4),
  }),
  projects: z.object({
    id,
    title: title(200),
    category: z.enum(PROJECT_CATEGORIES).catch("Personal"),
    goalId: refId,
  }),
  goals: z.object({
    id,
    title: title(200),
    description: optionalText(5000),
    category: z.enum(PROJECT_CATEGORIES).catch("Personal"),
    targetDate: optionalDate,
  }),
  assessments: z.object({
    id,
    courseId: OPAQUE_ID,
    title: title(120),
    weight: z.number().min(0).max(100),
    score: z.number().min(0).max(1000).nullish().transform((value) => value ?? null),
    maxScore: z.number().min(0.01).max(1000),
    dueDate: optionalDate,
  }),
  notes: z.object({
    id,
    title: title(200),
    content: z.preprocess((value) => value ?? "", noteContent),
    tags,
    isFavorite: z.boolean().catch(false),
    projectId: refId,
    courseId: refId,
  }),
  tasks: z.object({
    id,
    title: title(200),
    description: optionalText(5000),
    status: z.enum(TASK_STATUSES).catch("todo"),
    priority: z.enum(TASK_PRIORITIES).catch("medium"),
    tags,
    dueDate: optionalDate,
    estimatedMinutes: z.number().int().min(1).max(1440).catch(60),
    scheduledStart: optionalDate,
    scheduledEnd: optionalDate,
    completedAt: optionalDate,
    recurrenceId: refId,
    projectId: refId,
    courseId: refId,
    noteId: refId,
    goalId: refId,
    assessmentId: refId,
  }),
  checklistItems: z.object({
    id,
    taskId: OPAQUE_ID,
    title: title(200),
    done: z.boolean().catch(false),
    position: z.number().int().min(0).max(100_000).catch(0),
  }),
  events: z.object({
    id,
    title: title(200),
    description: optionalText(5000),
    location: optionalText(200),
    startTime: date,
    endTime: date,
    recurrenceId: refId,
    projectId: refId,
    courseId: refId,
    // A row a calendar feed brought in is not restored: the feed is not in the file, and adding the feed again brings it back.
    subscriptionId: refId,
    externalUid: z.string().max(1000).nullish().catch(null),
  }),
  references: z.object({
    key: z.string().min(1).max(200),
    type: z.string().max(40),
    title: z.string().min(1).max(1000),
    authors: z.unknown().catch([]),
    year: z.number().int().nullish().catch(null),
    details: z.record(z.string(), z.unknown()).catch({}),
  }),
  flashcards: z.object({
    id,
    noteId: refId,
    question: z.string().trim().min(1).max(MAX_CARD_QUESTION),
    answer: z.string().trim().min(1).max(MAX_CARD_ANSWER),
    clozeIndex: z.number().int().min(1).max(99).nullish().transform((value) => value ?? null),
    easeFactor: z.number().min(1.3).max(5).catch(2.5),
    intervalDays: z.number().int().min(0).max(36_500).catch(0),
    repetitions: z.number().int().min(0).max(1000).catch(0),
    dueAt: date.catch(new Date(0)),
    lastReviewed: optionalDate,
  }),
} as const;

export type RestoreKind = keyof typeof rowSchemas;
export const RESTORE_KINDS = Object.keys(rowSchemas) as RestoreKind[];
export type Rows = { [K in RestoreKind]: z.output<(typeof rowSchemas)[K]>[] };

/** What a person is told is not restored, kept beside the code that decides it. */
export const NOT_RESTORED: Readonly<Record<string, string>> = {
  profile: "Your settings (target GPA, scale, reminders) stay as they are here.",
  auditEvents: "The audit trail is a record of what happened on the server it was kept on.",
  conversations: "Assistant threads and their messages.",
  focusTelemetry: "Writing-time and study-time records.",
  noteVersions: "Older versions of notes.",
  attachments: "Attached files: the file holds their records, not the files themselves.",
  calendarSubscriptions: "Calendar feeds: the file holds only each feed's host. Add the feed again to bring its events back.",
  links: "Links between notes are rebuilt from the notes' text.",
};

export type RowProblem = { table: RestoreKind; index: number; reason: string };
export type ParsedFile = {
  rows: Rows;
  /** Rows in the file per table, before any were dropped for being invalid or over the cap. */
  found: Record<RestoreKind, number>;
  /** Rows that did not pass their checks: the first few, and the total. */
  invalid: RowProblem[];
  invalidTotal: number;
  /** Rows past the per-table cap. */
  overCap: number;
};
export type ParseResult = { ok: true; file: ParsedFile } | { ok: false; message: string };

const refuse = (message: string): ParseResult => ({ ok: false, message });

/**
 * The file's bytes as the tables this app can restore, or one sentence saying why not. A file that is not
 * JSON, not an export of this app, or from a newer version is refused whole; an odd row is dropped and counted.
 */
export function parseExportFile(bytes: Uint8Array): ParseResult {
  if (bytes.byteLength === 0) return refuse("That file is empty.");
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return refuse("That is not an Anamnesis export: the file is not valid JSON.");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return refuse("That is not an Anamnesis export: it should be one JSON object.");
  }
  const root = data as Record<string, unknown>;
  const version = root.formatVersion;
  if (version !== undefined) {
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
      return refuse("That is not an Anamnesis export: its format version is not a number.");
    }
    if (version > EXPORT_FORMAT_VERSION) {
      return refuse(`That export is from a newer version of Anamnesis (format ${version}); this one reads up to ${EXPORT_FORMAT_VERSION}. Update, then try again.`);
    }
  }

  const rows = Object.fromEntries(RESTORE_KINDS.map((kind) => [kind, []])) as unknown as Rows;
  const found = Object.fromEntries(RESTORE_KINDS.map((kind) => [kind, 0])) as Record<RestoreKind, number>;
  const invalid: RowProblem[] = [];
  let invalidTotal = 0;
  let overCap = 0;
  let recognised = 0;

  for (const kind of RESTORE_KINDS) {
    const table = Object.hasOwn(root, kind) ? root[kind] : undefined;
    if (!Array.isArray(table)) continue;
    recognised += 1;
    found[kind] = table.length;
    const schema = rowSchemas[kind];
    for (let index = 0; index < table.length; index++) {
      if (index >= RESTORE_LIMITS.maxRows) {
        overCap += table.length - index;
        break;
      }
      const parsed = schema.safeParse(table[index]);
      if (parsed.success) {
        (rows[kind] as unknown[]).push(parsed.data);
      } else {
        invalidTotal += 1;
        if (invalid.length < RESTORE_LIMITS.listCap) {
          invalid.push({ table: kind, index, reason: parsed.error.issues[0]?.message ?? "invalid" });
        }
      }
    }
  }
  if (recognised === 0) {
    return refuse("That is not an Anamnesis export: none of its tables (notes, tasks, events…) are in it.");
  }
  return { ok: true, file: { rows, found, invalid, invalidTotal, overCap } };
}

// --- "already here" -------------------------------------------------------------------------------
//
// An id in a file says nothing about the account being restored into, so a row is judged by what it
// is. A key is lower-cased and trimmed text; two rows with one key are the same row, so restoring
// twice (or restoring a file that holds a copy twice) adds nothing. Nothing is overwritten.

const fold = (text: string) => normalizeTitle(text);
const ms = (value: Date | null) => (value === null ? "" : String(value.getTime()));
const SEP = "\u0000";

export const keys = {
  course: (code: string, term: string) => `${fold(code)}${SEP}${fold(term)}`,
  project: (name: string) => fold(name),
  goal: (name: string) => fold(name),
  assessment: (courseId: string, name: string, due: Date | null) => `${courseId}${SEP}${fold(name)}${SEP}${ms(due)}`,
  task: (name: string, due: Date | null, courseId: string | null) => `${fold(name)}${SEP}${ms(due)}${SEP}${courseId ?? ""}`,
  event: (name: string, start: Date, end: Date) => `${fold(name)}${SEP}${ms(start)}${SEP}${ms(end)}`,
  card: (noteId: string | null, question: string, cloze: number | null) => `${noteId ?? ""}${SEP}${question}${SEP}${cloze ?? ""}`,
  reference: (key: string) => key.trim(),
  checklist: (taskId: string, name: string) => `${taskId}${SEP}${fold(name)}`,
} as const;

/** One lookup from an old id (a row of the file) to the id of the row in this account, created now or already there. */
export class IdMap {
  private readonly maps = new Map<RestoreKind, Map<string, string>>();

  set(kind: RestoreKind, oldId: string | undefined, newId: string): void {
    if (oldId === undefined) return;
    let map = this.maps.get(kind);
    if (!map) this.maps.set(kind, (map = new Map()));
    if (!map.has(oldId)) map.set(oldId, newId);
  }

  /** The id in this account for a reference in the file, or null when it points at nothing that was restored. */
  get(kind: RestoreKind, oldId: string | null): string | null {
    if (oldId === null) return null;
    return this.maps.get(kind)?.get(oldId) ?? null;
  }
}

/** A task's schedule as the app stores it: an end with no start, or no later than it, is dropped. */
export function normaliseSchedule(start: Date | null, end: Date | null): { start: Date | null; end: Date | null } {
  if (start === null) return { start: null, end: null };
  return { start, end: end !== null && end.getTime() > start.getTime() ? end : null };
}
