// What to send, and when. Pure: no clock of its own, no database, no network. The scheduler hands it
// "now", the account's choices and what is due, and gets back the notifications to send, each with the
// key that makes it send once (see ReminderDelivery).
//
// Times are the process's local time: the app container's TZ, set by ops to the owner's zone.

export type PushPrefs = { leadMinutes: number; digestHour: number; showTitles: boolean };

export type Planned = { key: string; title: string; body: string };

export const LEAD_CHOICES = [5, 10, 15, 30, 60] as const;
export const DIGEST_HOURS = [6, 7, 8, 9, 10, 11, 12] as const;
export const DEFAULT_PREFS: PushPrefs = { leadMinutes: 15, digestHour: 8, showTitles: true };

const MAX_TITLE = 120;
const DIGEST_NAMES = 5;

/** YYYY-MM-DD of the local day `at` falls on. */
export function localDateKey(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/** One line, at most 120 characters: a notification is not the place for a paragraph. */
function oneLine(title: string): string {
  const flat = title.replace(/\s+/g, " ").trim();
  return flat.length <= MAX_TITLE ? flat : `${flat.slice(0, MAX_TITLE - 1)}…`;
}

function digestBody(titles: string[], showTitles: boolean): string {
  if (!showTitles) return `${titles.length} task${titles.length === 1 ? "" : "s"} due today`;
  const named = titles.slice(0, DIGEST_NAMES).map(oneLine).join(", ");
  const rest = titles.length - DIGEST_NAMES;
  return rest > 0 ? `${named} and ${rest} more` : named;
}

/**
 * The notifications due at `now`:
 * - the digest of tasks due today, once the local hour reaches `digestHour` (and for the rest of that day,
 *   so a Mac that slept through the hour still sends it when it wakes);
 * - each event or planned task that starts after `now` and no later than `leadMinutes` from now. A start
 *   that has already passed is never announced: a reminder for something that began is noise.
 */
export function planReminders(input: {
  now: Date;
  prefs: PushPrefs;
  dueToday: { id: string; title: string }[];
  starting: { kind: "event" | "task"; id: string; title: string; start: Date }[];
}): Planned[] {
  const { now, prefs, dueToday, starting } = input;
  const out: Planned[] = [];

  if (dueToday.length > 0 && now.getHours() >= prefs.digestHour) {
    out.push({
      key: `digest:${localDateKey(now)}`,
      title: "Due today",
      body: digestBody(dueToday.map((task) => task.title), prefs.showTitles),
    });
  }

  const nowMs = now.getTime();
  const horizon = nowMs + prefs.leadMinutes * 60_000;
  const upcoming = starting
    .filter((item) => item.start.getTime() > nowMs && item.start.getTime() <= horizon)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  for (const item of upcoming) {
    // Rounded up, so it is never "0 min": the start is strictly ahead.
    const minutes = Math.ceil((item.start.getTime() - nowMs) / 60_000);
    out.push({
      key: `${item.kind}:${item.id}:${item.start.toISOString()}`,
      title: `Starts in ${minutes} min`,
      body: prefs.showTitles ? oneLine(item.title) : item.kind === "event" ? "An event" : "A planned task",
    });
  }

  return out;
}
