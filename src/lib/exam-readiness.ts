// What the "Next exam" card on Today shows about being ready for it (ROADMAP item 38). Pure: no Prisma and no React.

/** The big figure and the small word under it: today and tomorrow are said in words, a later day as a count. */
export function countdown(days: number): { big: string; small: string } {
  if (days <= 0) return { big: "Today", small: "" };
  if (days === 1) return { big: "Tomorrow", small: "" };
  return { big: String(days), small: "days left" };
}

export type PrepSession = { status: string; scheduledStart: Date | null; estimatedMinutes: number };

export type SessionProgress = {
  total: number;
  done: number;
  /** The earliest session not done that starts now or later, or null: a missed one is not "next". */
  next: { start: Date; minutes: number } | null;
  /** Done over total, a whole number; 0 with no sessions. */
  percent: number;
};

/** The review sessions made for one assessment, done and still to do, and the next one to sit. */
export function sessionProgress(sessions: readonly PrepSession[], now: Date): SessionProgress {
  const done = sessions.filter((session) => session.status === "done").length;
  let next: SessionProgress["next"] = null;
  for (const session of sessions) {
    if (session.status === "done" || session.scheduledStart === null || session.scheduledStart < now) continue;
    if (next === null || session.scheduledStart < next.start) next = { start: session.scheduledStart, minutes: session.estimatedMinutes };
  }
  return { total: sessions.length, done, next, percent: sessions.length === 0 ? 0 : Math.round((done / sessions.length) * 100) };
}
