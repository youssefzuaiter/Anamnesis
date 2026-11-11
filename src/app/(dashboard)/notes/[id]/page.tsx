import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserId } from "@/lib/session";
import { getNote } from "@/repositories/note-repository";
import { NoteEditor } from "@/components/note-editor";
import { updateNoteAction, deleteNoteAction } from "@/actions/notes";
import { listProjectOptions } from "@/repositories/project-repository";
import { listCourseOptions } from "@/repositories/course-repository";
import { scopeHref } from "@/lib/assistant-scope";
import { quizHref } from "@/lib/quiz";
import { getSettings } from "@/services/focus-service";
import { FocusTracker } from "@/components/focus-tracker";
import {
  getOutgoingLinks,
  getBacklinks,
  resolveNoteTitles,
} from "@/repositories/link-repository";
import { parseWikiLinks } from "@/lib/wiki-links";
import { NoteLinks } from "@/components/note-links";
import { listForNote } from "@/repositories/flashcard-repository";
import { CardMaker } from "@/components/card-maker";
import { GenerateCards } from "@/components/generate-cards";
import { NoteView } from "@/components/note-view";
import { NoteContent } from "@/components/note-content";
import { RelatedItems } from "@/components/related-items";
import { NoteAttachments } from "@/components/note-attachments";
import { listForNote as listAttachments } from "@/repositories/attachment-repository";
import { findRelated } from "@/services/search-service";
import { findMentionsOf, suggestLinks, type LinkSuggestion } from "@/services/link-suggestion-service";
import { LinkCard, type LinkRow } from "@/components/link-card";
import { RAIL_CARD } from "@/components/rail-card";
import { reasonLine } from "@/lib/link-reason";
import { normalizeTitle } from "@/lib/wiki-links";
import { Icon } from "@/components/icons";
import { citedKeys } from "@/lib/citations";
import { referencesByKeys } from "@/services/reference-service";
import { citationContext } from "@/components/note-citations";


export const metadata = { title: "Note · Anamnesis" };

const EDITED = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const suggestionRow = (item: LinkSuggestion): LinkRow => ({
  id: item.id,
  title: item.title,
  reason: reasonLine(item.reasons, item.similarity),
  snippet: item.snippet,
});
const mentionRow = (item: LinkSuggestion): LinkRow => ({
  id: item.id,
  title: item.title,
  reason: null,
  snippet: item.snippet,
});

export default async function NotePage({ params }: PageProps<"/notes/[id]">) {
  const userId = await requireUserId();
  const { id } = await params;

  const note = await getNote(userId, id);
  if (!note) notFound();

  const cited = citedKeys(note.content);
  const [projects, courses, outgoing, backlinks, titles, focusSwitches, cards, attachments, references] =
    await Promise.all([
      listProjectOptions(userId),
      listCourseOptions(userId),
      getOutgoingLinks(userId, note.id),
      getBacklinks(userId, note.id),
      Promise.resolve(parseWikiLinks(note.content)),
      getSettings(userId),
      listForNote(userId, note.id),
      listAttachments(userId, note.id),
      referencesByKeys(userId, cited),
    ]);
  const [{ resolved, unresolved }, related, suggestions, mentions] = await Promise.all([
    resolveNoteTitles(userId, titles),
    findRelated(userId, "note", note.id, 5),
    suggestLinks(userId, note.id),
    findMentionsOf(userId, note.id),
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
          className="mb-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px] text-text-faint"
        >
          <span className="min-w-0 truncate">
            <Link href="/notes" className="font-medium transition-colors hover:text-text">
              Notes
            </Link>
            {place && <span aria-hidden="true"> / </span>}
            {place && <span>{place}</span>}
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link
              href={scopeHref({ kind: "note", id: note.id })}
              className="font-medium transition-colors hover:text-text"
            >
              Ask about this note
            </Link>
            <Link
              href={quizHref({ kind: "note", id: note.id })}
              className="font-medium transition-colors hover:text-text"
            >
              Quiz me on this note
            </Link>
            <Link
              href={`/notes/${note.id}/history`}
              className="inline-flex shrink-0 items-center gap-1.5 font-medium transition-colors hover:text-text"
            >
              <Icon name="clock" className="size-4" />
              History
            </Link>
          </span>
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
          body={
            <NoteContent
              content={note.content}
              links={linkTargets}
              citations={citationContext(references.map((fields) => ({ id: fields.id, fields })), cited)}
            />
          }
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

        {focusSwitches.tracking && (
          <FocusTracker
            selector='textarea[name="content"]'
            includeCourse={focusSwitches.includeCourse}
            courseSelector='select[name="courseId"]'
          />
        )}

        <section className="mt-10 flex flex-col gap-3 border-t border-border-subtle pt-6">
          <GenerateCards noteId={note.id} existing={cards.length} />
          <CardMaker noteId={note.id} />
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

        <LinkCard
          key={`suggested-${note.id}`}
          heading="Suggested links"
          buttonLabel="Add link"
          writesInto="this"
          noteId={note.id}
          rows={suggestions.map(suggestionRow)}
        />

        <LinkCard
          key={`mentions-${note.id}`}
          heading="Mentions this note"
          help='Adding a link puts this note under "See also" in that note.'
          buttonLabel="Add link there"
          writesInto="listed"
          noteId={note.id}
          rows={mentions.map(mentionRow)}
        />

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
