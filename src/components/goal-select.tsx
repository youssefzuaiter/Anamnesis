import type { GoalOption } from "@/lib/domain";

export function GoalSelect({
  goals,
  defaultValue,
}: {
  goals: GoalOption[];
  defaultValue?: string | null;
}) {
  if (goals.length === 0) return null;

  return (
    <label className="flex flex-col gap-1 text-xs text-text-muted">
      Goal
      <select
        name="goalId"
        defaultValue={defaultValue ?? ""}
        aria-label="Goal"
        className="rounded-lg border border-border-subtle bg-surface-raised px-2.5 py-1.5 text-sm text-text focus:border-accent focus:outline-none"
      >
        <option value="">No goal</option>
        {goals.map((goal) => (
          <option key={goal.id} value={goal.id}>
            {goal.title}
          </option>
        ))}
      </select>
    </label>
  );
}
