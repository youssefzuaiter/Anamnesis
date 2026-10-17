import Link from "next/link";
import { requireUserId } from "@/lib/session";
import { listGoals } from "@/repositories/goal-repository";
import { GoalForm } from "@/components/goal-form";
import { createGoalAction } from "@/actions/goals";
import { hueForCategory, tintClass } from "@/lib/card-color";

export const metadata = { title: "Goals · Nexus" };

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

export default async function GoalsPage() {
  const userId = await requireUserId();
  const goals = await listGoals(userId);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Goals</h1>
        <p className="mt-1 text-sm text-text-muted">
          {goals.length} {goals.length === 1 ? "goal" : "goals"}
        </p>
      </header>

      <GoalForm action={createGoalAction} submitLabel="Create goal" resetOnSuccess />

      {goals.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border-strong px-4 py-10 text-center text-sm text-text-muted">
          No goals yet. Create one, then link projects and tasks to it as you
          go.
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {goals.map((goal) => (
            <li key={goal.id}>
              <Link
                href={`/goals/${goal.id}`}
                className={`block rounded-2xl p-4 transition-transform hover:-translate-y-0.5 ${tintClass(
                  hueForCategory(goal.category),
                )}`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="truncate font-medium text-text">
                    {goal.title}
                  </h2>
                  <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-xs text-text-muted">
                    {goal.category}
                  </span>
                </div>

                <div className="mt-2.5 flex items-center gap-3">
                  <div
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-raised"
                    role="progressbar"
                    aria-valuenow={goal.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${goal.title} progress`}
                  >
                    <div
                      className="h-full rounded-full bg-accent transition-[width]"
                      style={{ width: `${goal.progress}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-text-muted">
                    {goal.progress}%
                  </span>
                </div>

                <p className="mt-2 text-xs text-text-muted">
                  {goal.counts.projects} projects · {goal.counts.tasks} direct
                  tasks
                  {goal.targetDate && ` · targeting ${DATE.format(goal.targetDate)}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
