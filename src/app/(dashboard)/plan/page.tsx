import Link from "next/link";
import { requireUserId } from "@/lib/session";
import { addDays, startOfDay, startOfWeek } from "@/lib/study-stats";
import { isoDay, parseWeekParam } from "@/lib/week-planner";
import { PlanWeek } from "@/components/plan-week";

export const metadata = { title: "Plan my week · Anamnesis" };

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" });

const LINK = "inline-flex min-h-11 items-center rounded-lg border border-border-strong px-3.5 text-sm font-semibold text-text transition-colors hover:bg-surface-subtle sm:min-h-9";

/**
 * The week plan (ROADMAP item 51) on a page of its own. `?week=yyyy-mm-dd` names the week (any day in it); anything else is this week. The plan
 * itself is worked out only when asked for, in `PlanWeek`.
 */
export default async function PlanPage({ searchParams }: PageProps<"/plan">) {
  await requireUserId();
  const params = await searchParams;
  const monday = parseWeekParam(params.week) ?? startOfWeek(new Date());
  const sunday = addDays(monday, 6);
  const thisWeek = isoDay(startOfWeek(new Date())) === isoDay(monday);
  const label = `${DAY.format(monday)} to ${DAY.format(sunday)}`;

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">Plan my week</h1>
          <p className="mt-1 text-sm text-text-muted">{thisWeek ? "This week" : "Week"}, {label}</p>
        </div>
        <nav aria-label="Week" className="flex flex-wrap gap-2">
          <Link href={`/plan?week=${isoDay(addDays(monday, -7))}`} className={LINK}>Previous week</Link>
          {!thisWeek && <Link href="/plan" className={LINK}>This week</Link>}
          <Link href={`/plan?week=${isoDay(addDays(monday, 7))}`} className={LINK}>Next week</Link>
        </nav>
      </header>
      <PlanWeek key={isoDay(startOfDay(monday))} weekStart={isoDay(monday)} weekLabel={label} />
      <p className="mt-4 text-sm text-text-muted">
        Planned blocks appear on the <Link href={`/calendar?view=week&week=${isoDay(monday)}`} className="font-semibold text-accent-ink underline-offset-2 hover:underline">Calendar</Link> as dashed blocks. To plan just today, use Plan my day on Today.
      </p>
    </div>
  );
}
