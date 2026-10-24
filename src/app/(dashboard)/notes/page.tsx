import Link from "next/link";
import { requireUserId } from "@/lib/session";
import { searchNotes } from "@/services/note-service";
import { listNotes, listTags } from "@/repositories/note-repository";
import { NoteGrid } from "@/components/note-grid";
import { countNotes } from "@/repositories/note-repository";
import { listCourseOptions } from "@/repositories/course-repository";
import { listProjectOptions } from "@/repositories/project-repository";

// Enough to fill a screen without loading a whole imported vault at once.
const PAGE_SIZE = 24;

export const metadata = { title: "Notes · Anamnesis" };

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default async function NotesPage({
  searchParams,
}: PageProps<"/notes">) {
  const userId = await requireUserId();
  const params = await searchParams;

  const query = typeof params.q === "string" ? params.q : "";
  const tag = typeof params.tag === "string" ? params.tag : "";
  const favoritesOnly = params.favorites === "1";
  const page = Math.max(1, Number(params.page) || 1);

  const [result, tags, total, courses, projects] = await Promise.all([
    query
      ? searchNotes(userId, query)
      : listNotes(userId, {
          favoritesOnly,
          tag: tag || undefined,
          take: PAGE_SIZE,
          skip: (page - 1) * PAGE_SIZE,
        }).then((notes) => ({ mode: "semantic" as const, notes })),
    listTags(userId),
    countNotes(userId, { favoritesOnly, tag: tag || undefined }),
    listCourseOptions(userId),
    listProjectOptions(userId),
  ]);

  const { notes, mode } = result;

  // Search returns its own ranked set; paging applies to browsing only.
  const pageCount = query ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (target: number) => {
    const search = new URLSearchParams();
    if (tag) search.set("tag", tag);
    if (favoritesOnly) search.set("favorites", "1");
    if (target > 1) search.set("page", String(target));
    const qs = search.toString();
    return qs ? `/notes?${qs}` : "/notes";
  };

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">Notes</h1>
          <p className="mt-1 text-sm text-text-muted">
            {query ? notes.length : total}{" "}
            {(query ? notes.length : total) === 1 ? "note" : "notes"}
            {query && mode === "semantic" && " · ranked by meaning"}
            {query && mode === "keyword" && " · keyword match (model offline)"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/notes/graph"
            className="rounded-lg border border-border-subtle px-3.5 py-2 text-sm text-text transition-colors hover:bg-surface-subtle"
          >
            Graph view
          </Link>
          <Link
            href="/notes/import"
            className="rounded-lg border border-border-subtle px-3.5 py-2 text-sm text-text transition-colors hover:bg-surface-subtle"
          >
            Import PDF
          </Link>
          <Link
            href="/notes/new"
            className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
          >
            New note
          </Link>
        </div>
      </header>

      <form className="mb-4 flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Search your notes by meaning…"
          aria-label="Search notes"
          className="flex-1 rounded-lg border border-control bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg border border-border-subtle bg-surface px-3.5 py-2 text-sm text-text transition-colors hover:bg-surface-subtle"
        >
          Search
        </button>
      </form>

      {!query && (tags.length > 0 || favoritesOnly) && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <Link
            href="/notes"
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              !tag && !favoritesOnly
                ? "border-accent bg-accent-soft text-accent"
                : "border-border-subtle text-text-muted hover:bg-surface-subtle"
            }`}
          >
            All
          </Link>
          <Link
            href="/notes?favorites=1"
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              favoritesOnly
                ? "border-accent bg-accent-soft text-accent"
                : "border-border-subtle text-text-muted hover:bg-surface-subtle"
            }`}
          >
            Favorites
          </Link>
          {tags.map((name: string) => (
            <Link
              key={name}
              href={`/notes?tag=${encodeURIComponent(name)}`}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                tag === name
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border-subtle text-text-muted hover:bg-surface-subtle"
              }`}
            >
              {name}
            </Link>
          ))}
        </div>
      )}

      {notes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong px-4 py-10 text-center text-sm text-text-muted">
          {query
            ? `Nothing matched \u201c${query}\u201d.`
            : "No notes yet. Create your first one."}
        </p>
      ) : (
        <>
          <NoteGrid
            courses={courses}
            projects={projects}
            notes={notes.map((note) => ({
              id: note.id,
              title: note.title,
              excerpt: note.excerpt,
              tags: note.tags,
              isFavorite: note.isFavorite,
              updated: formatDate(note.updatedAt),
            }))}
          />

          {pageCount > 1 && (
            <nav className="mt-4 flex items-center justify-between gap-3 text-sm">
              {page > 1 ? (
                <Link
                  href={pageHref(page - 1)}
                  className="rounded-lg border border-border-subtle px-3 py-1.5 text-text transition-colors hover:bg-surface-subtle"
                >
                  ← Newer
                </Link>
              ) : (
                <span />
              )}
              <span className="text-text-muted">
                Page {page} of {pageCount}
              </span>
              {page < pageCount ? (
                <Link
                  href={pageHref(page + 1)}
                  className="rounded-lg border border-border-subtle px-3 py-1.5 text-text transition-colors hover:bg-surface-subtle"
                >
                  Older →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
