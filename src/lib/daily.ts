/**
 * The daily note and Shut down day: the rules, with no database and no React so
 * they can be unit-tested. `services/daily-service.ts` supplies the data and
 * does the writing.
 *
 * A daily note is an ordinary note. It is found by its title (the local ISO
 * date, so `[[2026-10-28]]` links to it) and the `daily` tag, never by a
 * special column.
 */

export const DAILY_TAG = "daily";

/** The local calendar day as `2026-10-28`. Not `toISOString`, which is UTC. */
export function dailyTitle(day: Date): string {
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
}

export type DailyEvent = {
  title: string;
  start: Date;
  end: Date;
  location: string | null;
};
export type DailyBlock = { title: string; start: Date; end: Date };
export type DailyTask = { title: string; priority: string };

const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * "09:00–11:00" for something inside the day. One that crosses an edge says so
 * ("until 02:00", "from 22:00", "All day") rather than printing times that are
 * not on this day.
 */
function whenLabel(start: Date, end: Date, day: Date): string {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const nextDay = new Date(dayStart);
  nextDay.setDate(nextDay.getDate() + 1);

  const startsBefore = start < dayStart;
  const endsAfter = end >= nextDay;
  if (startsBefore && endsAfter) return "All day";
  if (startsBefore) return `until ${TIME.format(end)}`;
  if (endsAfter) return `from ${TIME.format(start)}`;
  return `${TIME.format(start)}–${TIME.format(end)}`;
}

/**
 * The text a new daily note starts with: the day's schedule and its open tasks,
 * then an empty Notes section to write in. A snapshot: nothing updates it later.
 */
export function buildDailyNote(input: {
  day: Date;
  events: readonly DailyEvent[];
  blocks: readonly DailyBlock[];
  tasks: readonly DailyTask[];
}): string {
  const { day } = input;

  // `order` keeps an event ahead of a planned block that starts at the same time.
  const entries = [
    ...input.events.map((event) => ({
      start: event.start,
      order: 0,
      line: `- ${whenLabel(event.start, event.end, day)} ${event.title}${
        event.location ? `, ${event.location}` : ""
      }`,
    })),
    ...input.blocks.map((block) => ({
      start: block.start,
      order: 1,
      line: `- ${whenLabel(block.start, block.end, day)} ${block.title} (planned)`,
    })),
  ].sort((a, b) => a.start.getTime() - b.start.getTime() || a.order - b.order);

  const schedule =
    entries.length > 0 ? entries.map((entry) => entry.line) : ["Nothing scheduled."];
  const tasks =
    input.tasks.length > 0
      ? input.tasks.map((task) => `- [ ] ${task.title} (${task.priority}, due today)`)
      : ["No open tasks due today."];

  return [
    "## Schedule",
    ...schedule,
    "",
    "## Open tasks",
    ...tasks,
    "",
    "## Notes",
    "",
  ].join("\n");
}
