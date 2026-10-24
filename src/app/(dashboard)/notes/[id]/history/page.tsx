import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserId } from "@/lib/session";
import { getNote, listVersions } from "@/repositories/note-repository";
import { VersionRow } from "@/components/version-row";

export const metadata = { title: "History · Anamnesis" };

const WHEN = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function NoteHistoryPage({
  params,
}: PageProps<"/notes/[id]/history">) {
  const userId = await requireUserId();
  const { id } = await params;

  const note = await getNote(userId, id);
  if (!note) notFound();

  const versions = await listVersions(userId, note.id);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <Link
          href={`/notes/${note.id}`}
          className="text-sm text-text-muted transition-colors hover:text-text"
        >
          ← {note.title}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-text">
          History
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          A snapshot is kept each time the note is saved with changes. The last
          20 are retained.
        </p>
      </header>

      {versions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong px-4 py-10 text-center text-sm text-text-muted">
          No earlier versions yet — this note has not been edited since it was
          written.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {versions.map((version) => (
            <VersionRow
              key={version.id}
              id={version.id}
              title={version.title}
              when={WHEN.format(version.createdAt)}
              length={version.length}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
