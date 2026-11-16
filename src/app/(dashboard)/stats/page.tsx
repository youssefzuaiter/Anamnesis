import { requireUserId } from "@/lib/session";
import { getStats } from "@/services/stats-service";
import { StatsCharts } from "@/components/stats-charts";

export const metadata = { title: "Stats · Anamnesis" };

export default async function StatsPage() {
  const userId = await requireUserId();
  const stats = await getStats(userId);
  const { streak, days } = stats;

  const note = streak.current === 0
    ? "No streak yet. Finish a task, review a card or record study time today to start one."
    : `Longest: ${streak.longest} ${streak.longest === 1 ? "day" : "days"}. ${streak.todayActive ? "Today counts." : "Today counts once you do one thing."}`;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-text">Study stats</h1>
        <p className="mt-1 text-sm text-text-muted">Your last eight weeks, from what the app already records.</p>
      </header>

      <section aria-label="Streak" className="flex flex-wrap items-center justify-between gap-5 rounded-xl border border-border-subtle bg-surface p-5 shadow-card">
        <div>
          <p className="text-xs font-semibold text-text-faint">Current streak</p>
          <p className="mt-1 text-[40px] font-bold leading-none text-text">
            {streak.current}{" "}
            <span className="text-base font-semibold text-text-muted">{streak.current === 1 ? "day" : "days"}</span>
          </p>
          <p className="mt-2 text-sm text-text-muted">{note}</p>
        </div>
        <ol aria-label="The last seven days" className="flex gap-2">
          {days.map((day) => (
            <li key={day.key} className="flex flex-col items-center gap-1.5 text-xs text-text-muted">
              <span
                aria-hidden="true"
                className={`size-7 rounded-full border-2 ${day.active ? "border-accent bg-accent" : "border-control"}`}
              />
              <span>
                {day.label}
                <span className="sr-only"> {day.active ? "active" : "no activity"}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <StatsCharts stats={stats} />

      <p className="text-[13px] text-text-muted">
        A day counts when you finished a task, reviewed a card or recorded at least a minute of study time. Days are the server&apos;s local days; nothing here
        is sent anywhere.
      </p>
    </div>
  );
}
