import Link from "next/link";
import type { SemanticHit } from "@/services/search-service";

const KIND_LABEL: Record<string, string> = {
  note: "Note",
  task: "Task",
  event: "Event",
  project: "Project",
  course: "Course",
  goal: "Goal",
};

/**
 * Server component: the related lookup is a database query, so there is nothing
 * to hydrate and no reason to ship this to the browser.
 */
export function RelatedItems({ items }: { items: SemanticHit[] }) {
  return (
    <section>
      <h2 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-faint">
        Related
      </h2>

      {items.length === 0 ? (
        <p className="text-sm text-text-muted">
          Nothing else in your workspace is close to this yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`}>
              <Link
                href={item.href}
                className="flex items-center gap-2.5 rounded-lg border border-border-subtle px-3 py-2 text-sm transition-colors hover:bg-surface-raised"
              >
                <span className="shrink-0 text-xs text-text-faint">
                  {KIND_LABEL[item.kind]}
                </span>
                <span className="min-w-0 flex-1 truncate text-text">
                  {item.title}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-text-faint">
                  {item.similarity.toFixed(2)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
