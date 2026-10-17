import Link from "next/link";
import { requireUserId } from "@/lib/session";
import { searchEverything } from "@/services/search-service";
import { EMBEDDABLE_SOURCE_TYPES, type EmbeddableSourceType } from "@/lib/vector";

export const metadata = { title: "Search · Nexus" };

const KIND_LABEL: Record<string, string> = {
  note: "Note",
  task: "Task",
  event: "Event",
  project: "Project",
  course: "Course",
  goal: "Goal",
};

function isType(value: string): value is EmbeddableSourceType {
  return (EMBEDDABLE_SOURCE_TYPES as readonly string[]).includes(value);
}

export default async function SearchPage({
  searchParams,
}: PageProps<"/search">) {
  const userId = await requireUserId();
  const params = await searchParams;

  const query = typeof params.q === "string" ? params.q : "";
  const rawType = typeof params.type === "string" ? params.type : "";
  const type = isType(rawType) ? rawType : null;

  const { mode, hits } = await searchEverything(
    userId,
    query,
    type ? [type] : undefined,
  );

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Search</h1>
        <p className="mt-1 text-sm text-text-muted">
          Searches notes, tasks, events, projects, courses and goals by
          meaning rather than wording. For exact matches, the command palette
          (⌘K) is faster.
        </p>
      </header>

      <form className="mb-4 flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Ask in your own words — “where is my exam”"
          aria-label="Search everything"
          className="flex-1 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
        {type && <input type="hidden" name="type" value={type} />}
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          Search
        </button>
      </form>

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link
          href={`/search?q=${encodeURIComponent(query)}`}
          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
            type
              ? "border-border-subtle text-text-muted hover:bg-surface-raised"
              : "border-accent bg-accent-soft text-accent"
          }`}
        >
          Everything
        </Link>
        {EMBEDDABLE_SOURCE_TYPES.map((value) => (
          <Link
            key={value}
            href={`/search?q=${encodeURIComponent(query)}&type=${value}`}
            className={`rounded-full border px-2.5 py-1 text-xs capitalize transition-colors ${
              type === value
                ? "border-accent bg-accent-soft text-accent"
                : "border-border-subtle text-text-muted hover:bg-surface-raised"
            }`}
          >
            {value}s
          </Link>
        ))}
      </div>

      {mode === "unavailable" ? (
        <p className="rounded-xl border border-dashed border-border-strong px-4 py-10 text-center text-sm text-text-muted">
          Semantic search needs the local model. Start it with{" "}
          <code className="font-mono text-xs">ollama serve</code> and try again —
          the command palette still works without it.
        </p>
      ) : !query ? (
        <p className="rounded-xl border border-dashed border-border-strong px-4 py-10 text-center text-sm text-text-muted">
          Type a question above.
        </p>
      ) : hits.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong px-4 py-10 text-center text-sm text-text-muted">
          Nothing close enough to “{query}”.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {hits.map((hit) => (
            <li key={`${hit.kind}:${hit.id}`}>
              <Link
                href={hit.href}
                className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-3 transition-colors hover:border-border-strong"
              >
                <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-xs text-text-muted">
                  {KIND_LABEL[hit.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text">
                    {hit.title}
                  </span>
                  {hit.detail && (
                    <span className="block truncate text-xs text-text-muted">
                      {hit.detail}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-text-muted">
                  {hit.similarity.toFixed(2)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
