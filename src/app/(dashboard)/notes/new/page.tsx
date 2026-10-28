import Link from "next/link";
import { NoteEditor } from "@/components/note-editor";
import { createNoteAction } from "@/actions/notes";
import { getTemplate, renderTemplate } from "@/lib/note-templates";
import { requireUserId } from "@/lib/session";
import { listProjectOptions } from "@/repositories/project-repository";
import { listCourseOptions } from "@/repositories/course-repository";
import { isTrackingEnabled } from "@/repositories/focus-repository";
import { FocusTracker } from "@/components/focus-tracker";


export const metadata = { title: "New note · Anamnesis" };

export default async function NewNotePage({
  searchParams,
}: PageProps<"/notes/new">) {
  const userId = await requireUserId();
  const params = await searchParams;
  const presetTitle = typeof params.title === "string" ? params.title.slice(0, 200) : "";
  // Only a plain string can name a template; an unknown id, a repeated
  // parameter (an array) or an absurdly long value is Blank.
  const template = getTemplate(
    typeof params.template === "string" ? params.template : undefined,
  );
  const filled = renderTemplate(template, new Date());
  const [projects, courses, trackFocus] = await Promise.all([
    listProjectOptions(userId),
    listCourseOptions(userId),
    isTrackingEnabled(userId),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <Link
          href="/notes"
          className="text-sm text-text-muted transition-colors hover:text-text"
        >
          ← Notes
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-text">
          New note
        </h1>
      </header>

      <NoteEditor
        action={createNoteAction}
        submitLabel="Create note"
        projects={projects}
        courses={courses}
        templatePicker={{ initialTemplateId: template.id }}
        initial={{
          title: presetTitle || filled.title,
          content: filled.content,
          tags: [...template.tags],
          isFavorite: false,
          projectId: null,
          courseId: null,
        }}
      />

      {trackFocus && <FocusTracker selector='textarea[name="content"]' />}
    </div>
  );
}
