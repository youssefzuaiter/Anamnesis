import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserId } from "@/lib/session";
import { getNote } from "@/repositories/note-repository";
import { NoteEditor } from "@/components/note-editor";
import { updateNoteAction, deleteNoteAction } from "@/actions/notes";
import { listProjectOptions } from "@/repositories/project-repository";
import { listCourseOptions } from "@/repositories/course-repository";
import { isTrackingEnabled } from "@/repositories/focus-repository";
import { FocusTracker } from "@/components/focus-tracker";
import {
  getOutgoingLinks,
  getBacklinks,
  resolveNoteTitles,
} from "@/repositories/link-repository";
import { parseWikiLinks } from "@/lib/wiki-links";
import { NoteLinks } from "@/components/note-links";
import { listForNote } from "@/repositories/flashcard-repository";
import { GenerateCards } from "@/components/generate-cards";
import { NoteView } from "@/components/note-view";
import { NoteContent } from "@/components/note-content";
import { RelatedItems } from "@/components/related-items";
import { NoteAttachments } from "@/components/note-attachments";
import { listForNote as listAttachments } from "@/repositories/attachment-repository";
import { findRelated } from "@/services/search-service";
import { normalizeTitle } from "@/lib/wiki-links";
import { Icon } from "@/components/icons";


export const metadata = { title: "Note · Anamnesis" };

const EDITED = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const RAIL_CARD = "rounded-xl border border-border-subtle bg-surface p-4 shadow-card";

export default async function NotePage({ params }: PageProps<"/notes/[id]">) {
  const userId = await requireUserId();
  const { id } = await params;

  const note = await getNote(userId, id);
  if (!note) notFound();

  const [projects, courses, outgoing, backlinks, titles, trackFocus, cards, attachments] =
    await Promise.all([
      listProjectOptions(userId),
      listCourseOptions(userId),
      getOutgoingLinks(userId, note.id),
      getBacklinks(userId, note.id),
      Promise.resolve(parseWikiLinks(note.content)),
      isTrackingEnabled(userId),
      listForNote(userId, note.id),
      listAttachments(userId, note.id),
    ]);
  const [{ resolved, unresolved }, related] = await Promise.all([
    resolveNoteTitles(userId, titles),
    findRelated(userId, "note", note.id, 5),
  ]);

  // Normalized title -> id, so the renderer can turn [[Title]] into a real link
  // without re-querying per link.
  const linkTargets: Record<string, string | null> = {};
  for (const title of titles) linkTargets[normalizeTitle(title)] = null;
  for (const target of resolved) linkTargets[normalizeTitle(target.title)] = target.id;

  const updateThisNote = updateNoteAction.bind(null, note.id);
  const course = courses.find((option) => option.id === note.courseId);
  const project = projects.find((option) => option.id === note.projectId);
  const place = course ? `${course.code} ${course.title}` : project?.title;
  const deleteThisNote = deleteNoteAction.bind(null, note.id);

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_300px]">
      <article className="min-w-0">
        <nav
          aria-label="Breadcrumb"
          className="mb-5 flex items-center justify-between gap-3 text-[13px] text-text-faint"
        >
          <span className="min-w-0 truncate">
            <Link href="/notes" className="font-medium transition-colors hover:text-text">
              Notes
            </Link>
            {place && <span aria-hidden="true"> / </span>}
            {place && <span>{place}</span>}
          </span>
          <Link
            href={`/notes/${note.id}/history`}
            className="inline-flex shrink-0 items-center gap-1.5 font-medium transition-colors hover:text-text"
          >
            <Icon name="clock" className="size-4" />
            History
          </Link>
        </nav>

        <NoteView
          header={
            <>
              <h1 className="text-[32px] font-bold leading-tight text-text">
                {note.isFavorite && (
                  <>
                    <span aria-hidden="true" className="mr-2 text-accent-ink">
                      ★
                    </span>
                    <span className="sr-only">Favourite: </span>
                  </>
                )}
                {note.title}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold">
                {place && (
                  <span className="rounded-full bg-accent-soft px-2.5 py-1 text-accent-ink">
                    {place}
                  </span>
                )}
                {note.tags.map((name) => (
                  <Link
                    key={name}
                    href={`/notes?tag=${encodeURIComponent(name)}`}
                    className="rounded-full bg-surface-subtle px-2.5 py-1 text-text-muted hover:text-text"
                  >
                    #{name}
                  </Link>
                ))}
                <span className="px-1 font-medium text-text-faint">
                  Edited {EDITED.format(note.updatedAt)}
                </span>
              </div>
            </>
          }
          body={<NoteContent content={note.content} links={linkTargets} />}
          editor={
            <NoteEditor
              action={updateThisNote}
              submitLabel="Save changes"
              projects={projects}
              courses={courses}
              initial={{
                title: note.title,
                content: note.content,
                tags: note.tags,
                isFavorite: note.isFavorite,
                projectId: note.projectId,
                courseId: note.courseId,
              }}
              onDelete={deleteThisNote}
            />
          }
        />

        {trackFocus && <FocusTracker selector='textarea[name="content"]' />}

        <section className="mt-10 border-t border-border-subtle pt-6">
          <GenerateCards noteId={note.id} existing={cards.length} />
        </section>
      </article>

      {/* The note's context sits beside it on a wide screen and below it on a
          narrow one; in the DOM it always follows the note itself. */}
      <aside aria-label="Note context" className="flex flex-col gap-4 xl:pt-12">
        <section className={RAIL_CARD}>
          <NoteLinks
            outgoing={outgoing}
            backlinks={backlinks}
            unresolved={unresolved}
          />
        </section>

        <section className={RAIL_CARD}>
          <RelatedItems items={related} />
        </section>

        <section className={RAIL_CARD}>
          <NoteAttachments
            noteId={note.id}
            attachments={attachments.map((attachment) => ({
              id: attachment.id,
              filename: attachment.filename,
              mimeType: attachment.mimeType,
              size: `${Math.max(1, Math.round(attachment.byteSize / 1024))} KB`,
              isImage: attachment.mimeType.startsWith("image/"),
            }))}
          />
        </section>
      </aside>
    </div>
  );
}
