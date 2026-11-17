import Link from "next/link";
import { GoalBar } from "@/components/goal-bar";
import type { WeeklyGoalsOverview } from "@/services/weekly-goal-service";

/** This week's goals on Today, read only. Absent when there are none: Today does not nag a person who has set none. */
export function TodayGoals({ overview }: { overview: WeeklyGoalsOverview }) {
  if (overview.goals.length === 0) return null;
  return (
    <section aria-labelledby="week-goals-title" className="rounded-xl border border-border-subtle bg-surface px-5 py-4 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="week-goals-title" className="text-sm font-semibold text-text">
          This week
        </h2>
        <Link href="/stats#weekly-goals" className="inline-flex min-h-11 items-center text-[13px] font-semibold text-accent-ink hover:underline">
          All goals
        </Link>
      </div>
      <ul className="flex flex-col gap-3">
        {overview.goals.map((goal) => (
          <li key={goal.id}>
            <GoalBar label={goal.label} progress={goal.progress} compact />
          </li>
        ))}
      </ul>
    </section>
  );
}
