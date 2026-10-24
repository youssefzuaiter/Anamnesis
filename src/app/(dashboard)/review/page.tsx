import Link from "next/link";
import { requireUserId } from "@/lib/session";
import { buildWeeklyReview } from "@/services/review-service";
import { WeekSummary } from "@/components/week-summary";

export const metadata = { title: "Weekly review · Anamnesis" };

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-4">
      <p className="text-2xl font-semibold tabular-nums text-text">{value}</p>
      <p className="mt-0.5 text-xs text-text-muted">{label}</p>
    </div>
  );
}

function List({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: { id: string; title: string; href: string; when: string }[];
}) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xs font-semibold text-text-faint">
        {title} · {items.length}
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-2.5"
            >
              <Link
                href={item.href}
                className="min-w-0 flex-1 truncate text-sm text-text transition-colors hover:text-accent"
              >
                {item.title}
              </Link>
              <span className="shrink-0 text-xs text-text-muted">
                {item.when}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function ReviewPage() {
  const userId = await requireUserId();
  const review = await buildWeeklyReview(userId);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Weekly review
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {DAY.format(review.from)} – {DAY.format(review.to)}
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Tasks finished" value={review.completed.length} />
        <Stat label="Still overdue" value={review.slipped.length} />
        <Stat label="Notes touched" value={review.notesWritten.length} />
        <Stat label="Cards reviewed" value={review.cardsReviewed} />
      </section>

      <div className="mt-6">
        <WeekSummary />
      </div>

      <List
        title="Finished"
        empty="Nothing was marked done this week."
        items={review.completed.map((task) => ({
          id: task.id,
          title: task.title,
          href: `/tasks/${task.id}`,
          when: DAY.format(task.completedAt),
        }))}
      />

      <List
        title="Slipped"
        empty="Nothing went past its due date."
        items={review.slipped.map((task) => ({
          id: task.id,
          title: task.title,
          href: `/tasks/${task.id}`,
          when: `due ${DAY.format(task.dueDate)}`,
        }))}
      />

      <List
        title="Coming up"
        empty="Nothing due in the next seven days."
        items={review.upcoming.map((task) => ({
          id: task.id,
          title: task.title,
          href: `/tasks/${task.id}`,
          when: DAY.format(task.dueDate),
        }))}
      />
    </div>
  );
}
