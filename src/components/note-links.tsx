import Link from "next/link";
import type { LinkedNote } from "@/repositories/link-repository";

function NoteList({ notes }: { notes: LinkedNote[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {notes.map((note) => (
        <li key={note.id}>
          <Link
            href={`/notes/${note.id}`}
            className="inline-block max-w-64 truncate rounded-full border border-border-subtle px-2.5 py-1 text-xs text-accent transition-colors hover:bg-accent-soft"
          >
            {note.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function NoteLinks({
  outgoing,
  backlinks,
  unresolved,
}: {
  outgoing: LinkedNote[];
  backlinks: LinkedNote[];
  unresolved: string[];
}) {
  const hasAny =
    outgoing.length > 0 || backlinks.length > 0 || unresolved.length > 0;

  if (!hasAny) {
    return (
      <p className="text-xs text-text-faint">
        Write <code className="font-mono">[[Another note]]</code> to link notes
        together.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {outgoing.length > 0 && (
        <div>
          <h2 className="mb-1.5 text-xs font-semibold text-text-faint">
            Links to · {outgoing.length}
          </h2>
          <NoteList notes={outgoing} />
        </div>
      )}

      {backlinks.length > 0 && (
        <div>
          <h2 className="mb-1.5 text-xs font-semibold text-text-faint">
            Linked from · {backlinks.length}
          </h2>
          <NoteList notes={backlinks} />
        </div>
      )}

      {unresolved.length > 0 && (
        <div>
          <h2 className="mb-1.5 text-xs font-semibold text-text-faint">
            Not yet written · {unresolved.length}
          </h2>
          <ul className="flex flex-wrap gap-1.5">
            {unresolved.map((title) => (
              <li key={title}>
                <Link
                  href={`/notes/new?title=${encodeURIComponent(title)}`}
                  title={`Create "${title}"`}
                  className="inline-block max-w-64 truncate rounded-full border border-dashed border-border-strong px-2.5 py-1 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent"
                >
                  {title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
