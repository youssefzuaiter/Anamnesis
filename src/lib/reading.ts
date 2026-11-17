// Reading state of a reference (ROADMAP item 43): to read, reading or done, with a one-line takeaway. Pure: no Prisma, no React.
import { z } from "zod";

export const READ_STATUSES = ["to_read", "reading", "done"] as const;
export type ReadStatus = (typeof READ_STATUSES)[number];
export const MAX_TAKEAWAY = 200;

const LABELS: Record<ReadStatus, string> = { to_read: "To read", reading: "Reading", done: "Done" };
export const readStatusLabel = (status: ReadStatus): string => LABELS[status];

/** The status an address names: only one plain string that is exactly a status. Anything else, a repeated parameter included, is no filter. */
export function parseStatusParam(value: unknown): ReadStatus | null {
  return typeof value === "string" && (READ_STATUSES as readonly string[]).includes(value) ? (value as ReadStatus) : null;
}

/** A takeaway is one line: every run of white space (breaks included) becomes one space, the ends are trimmed, and nothing left is no takeaway. */
export function tidyTakeaway(text: string): string | null {
  const tidy = text.replace(/\s+/g, " ").trim();
  return tidy === "" ? null : tidy;
}

export const readingSchema = z.object({
  status: z.enum(READ_STATUSES),
  takeaway: z
    .union([z.string().max(MAX_TAKEAWAY * 20, `A takeaway is at most ${MAX_TAKEAWAY} characters.`), z.null()])
    .transform((value) => (value === null ? null : tidyTakeaway(value)))
    .refine((value) => value === null || value.length <= MAX_TAKEAWAY, `A takeaway is at most ${MAX_TAKEAWAY} characters.`),
});
export type ReadingInput = z.infer<typeof readingSchema>;

export function countByStatus(statuses: string[]): Record<ReadStatus, number> {
  const counts: Record<ReadStatus, number> = { to_read: 0, reading: 0, done: 0 };
  for (const status of statuses) if ((READ_STATUSES as readonly string[]).includes(status)) counts[status as ReadStatus]++;
  return counts;
}
