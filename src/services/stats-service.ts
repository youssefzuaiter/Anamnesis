import "server-only";
import { activeDays, lastDays, streaks, weeklyTotals, type Streaks, type WeekTotals } from "@/lib/study-stats";
import * as focusRepository from "@/repositories/focus-repository";
import * as statsRepository from "@/repositories/stats-repository";

/** How far back activity is read: far enough for a long streak, bounded so the page stays cheap. */
const HISTORY_DAYS = 400;

export type StatsOverview = {
  weeks: WeekTotals[];
  streak: Streaks;
  /** The last seven days, oldest first, ending today. */
  days: { key: string; label: string; active: boolean }[];
  /** Whether the study recorder is on: study time is empty without it. */
  recorderOn: boolean;
  /** When the card review log starts for this account, or null if no card has been reviewed since it began. */
  cardLogSince: Date | null;
  /** Whether anything at all has happened in the window. */
  hasActivity: boolean;
};

/** The streak and the eight weekly totals for the stats page. Read only: nothing is written. */
export async function getStats(userId: string, now: Date = new Date()): Promise<StatsOverview> {
  if (typeof userId !== "string" || userId === "") throw new Error("A stats page needs an account.");
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - HISTORY_DAYS);
  const until = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const [tasks, cards, sessions, switches, cardLogSince] = await Promise.all([
    statsRepository.listTaskCompletions(userId, since, until),
    statsRepository.listCardReviews(userId, since, until),
    statsRepository.listStudySessions(userId, since, until),
    focusRepository.getSettings(userId),
    statsRepository.firstCardReview(userId),
  ]);
  const activity = {
    tasks: tasks.flatMap((row) => (row.completedAt ? [row.completedAt] : [])),
    cards: cards.map((row) => row.reviewedAt),
    study: sessions.map((row) => ({ at: row.recordedAt, seconds: row.seconds })),
  };
  const active = activeDays(activity);
  return {
    weeks: weeklyTotals(activity, now),
    streak: streaks(active, now),
    days: lastDays(active, now, 7),
    recorderOn: switches.timer,
    cardLogSince,
    hasActivity: active.size > 0,
  };
}
