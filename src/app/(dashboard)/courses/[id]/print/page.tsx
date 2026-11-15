import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserId } from "@/lib/session";
import { listCourses } from "@/repositories/course-repository";
import { listCourseNotesForPrint } from "@/repositories/note-repository";
import { resolveNoteTitles } from "@/repositories/link-repository";
import { referencesByKeys } from "@/services/reference-service";
import { NoteContent } from "@/components/note-content";
import { citationContext } from "@/components/note-citations";
import { PrintButton } from "@/components/print-button";
import { citedKeys } from "@/lib/citations";
import { parseWikiLinks, normalizeTitle } from "@/lib/wiki-links";
import { PRINT_NOTE_LIMIT, splitPrintable } from "@/lib/print";

export const metadata = { title: "Print course notes · Anamnesis" };

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function CoursePrintPage({ params }: PageProps<"/courses/[id]/print">) {
  const userId = await requireUserId();
  const { id } = await params;

  const course = (await listCourses(userId)).find((item) => item.id === id);
  if (!course) notFound();

  const { shown: notes, leftOut } = splitPrintable(
    await listCourseNotesForPrint(userId, course.id, PRINT_NOTE_LIMIT + 1),
  );

  // One lookup for every link and every cited work in the document, not one per note.
  const titles = [...new Set(notes.flatMap((note) => parseWikiLinks(note.content)))];
  const keys = [...new Set(notes.flatMap((note) => citedKeys(note.content)))];
  const [{ resolved }, references] = await Promise.all([
    resolveNoteTitles(userId, titles),
    referencesByKeys(userId, keys),
  ]);
  const linkTargets: Record<string, string | null> = {};
  for (const title of titles) linkTargets[normalizeTitle(title)] = null;
  for (const target of resolved) linkTargets[normalizeTitle(target.title)] = target.id;
  const refs = references.map((fields) => ({ id: fields.id, fields }));
  const cited = (content: string) => new Set(citedKeys(content));

  return (
    <div className="mx-auto max-w-3xl print:max-w-none">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/courses/${course.id}`} className="text-sm text-text-muted transition-colors hover:text-text">
          ← {course.code}
        </Link>
        <PrintButton
          label="Print or save as PDF"
          className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover"
        />
      </div>

      <header>
        <h1 className="text-3xl font-bold tracking-tight text-text">
          {course.code} · {course.title}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {course.term} · {notes.length} note{notes.length === 1 ? "" : "s"} · printed {DATE.format(new Date())}
        </p>
        {leftOut && (
          <p role="status" className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn print:border print:border-black">
            This course has more than {PRINT_NOTE_LIMIT} notes. The first {PRINT_NOTE_LIMIT}, in the order they were
            written, are shown.
          </p>
        )}
      </header>

      {notes.length === 0 ? (
        <p className="mt-8 text-sm text-text-muted">This course has no notes to print.</p>
      ) : (
        <>
          <ol aria-label="Contents" className="mt-6 list-decimal space-y-1 pl-6 text-[15px] text-text">
            {notes.map((note) => (
              <li key={note.id}>{note.title}</li>
            ))}
          </ol>

          {notes.map((note) => (
            <section
              key={note.id}
              aria-label={note.title}
              className="mt-10 border-t border-border-subtle pt-8 print:mt-0 print:border-0 print:pt-0 print:break-before-page"
            >
              <h2 className="text-2xl font-bold leading-tight text-text">{note.title}</h2>
              <p className="mb-5 mt-2 text-xs font-medium text-text-faint">
                {note.tags.length > 0 && `${note.tags.map((name) => `#${name}`).join(" ")} · `}
                Edited {DATE.format(note.updatedAt)}
              </p>
              <NoteContent
                content={note.content}
                links={linkTargets}
                citations={citationContext(
                  // Only this note's own works, so "2020a" and "2020b" read as they do on the note's page.
                  refs.filter((ref) => cited(note.content).has(ref.fields.key)),
                  citedKeys(note.content),
                )}
              />
            </section>
          ))}
        </>
      )}
    </div>
  );
}
