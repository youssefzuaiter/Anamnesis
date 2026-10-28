"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ApiResponse } from "@/lib/api-response";
import type { ProjectOption } from "@/lib/domain";
import {
  BLANK_TEMPLATE_ID,
  NOTE_TEMPLATES,
  applyTemplate,
  getTemplate,
  planTemplateChange,
  type TemplateFields,
} from "@/lib/note-templates";
import { ProjectSelect } from "@/components/project-select";
import { CourseSelect, type CourseOption } from "@/components/course-select";
import { TemplatePicker } from "@/components/template-picker";

type EditorAction<T> = (
  prevState: ApiResponse<T> | null,
  formData: FormData,
) => Promise<ApiResponse<T>>;

type NoteEditorProps<T> = {
  action: EditorAction<T>;
  submitLabel: string;
  projects: ProjectOption[];
  courses: CourseOption[];
  initial?: {
    title: string;
    content: string;
    tags: string[];
    isFavorite: boolean;
    projectId: string | null;
    courseId: string | null;
  };
  /** Only the create form passes this; editing an existing note has no templates. */
  templatePicker?: { initialTemplateId: string };
  onDelete?: () => Promise<void>;
};

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(event) => {
        if (!confirm("Delete this note? It will stop appearing in search.")) {
          event.preventDefault();
        }
      }}
      className="rounded-lg px-3 py-2 text-sm text-text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-60"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}

export function NoteEditor<T>({
  action,
  submitLabel,
  initial,
  projects,
  courses,
  templatePicker,
  onDelete,
}: NoteEditorProps<T>) {
  const [state, formAction] = useActionState(action, null);
  const [isFavorite, setIsFavorite] = useState(initial?.isFavorite ?? false);

  // Controlled, because a template pick writes into these fields. React 19
  // resets uncontrolled fields to their defaultValue when a form action ends,
  // which would drop what a pick wrote if a save came back with an error.
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [tags, setTags] = useState(initial?.tags.join(", ") ?? "");
  const [templateId, setTemplateId] = useState(
    templatePicker?.initialTemplateId ?? BLANK_TEMPLATE_ID,
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const current = { templateId, title, content, tags };

  function write(id: string, values: TemplateFields) {
    setTitle(values.title);
    setContent(values.content);
    setTags(values.tags);
    setTemplateId(id);
    setPendingId(null);
  }

  function pickTemplate(id: string) {
    const change = planTemplateChange({ current, targetId: id, now: new Date() });
    if (change.action === "none") setPendingId(null);
    else if (change.action === "confirm") setPendingId(id);
    else write(id, change.values);
  }

  function replaceWithPending() {
    if (pendingId === null) return;
    write(pendingId, applyTemplate(current, pendingId, new Date()));
    contentRef.current?.focus();
  }

  function keepMyText() {
    setPendingId(null);
    contentRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-col gap-4">
        {templatePicker && (
          <TemplatePicker
            templates={NOTE_TEMPLATES}
            selectedId={templateId}
            pendingName={pendingId === null ? null : getTemplate(pendingId).name}
            onPick={pickTemplate}
            onReplace={replaceWithPending}
            onKeep={keepMyText}
          />
        )}

        <input
          name="title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Note title"
          required
          maxLength={200}
          aria-label="Note title"
          className="w-full rounded-lg border border-control bg-surface px-3 py-2.5 text-lg font-semibold text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
        />

        <textarea
          ref={contentRef}
          name="content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Start writing…"
          rows={16}
          aria-label="Note content"
          className="w-full resize-y rounded-lg border border-control bg-surface px-3 py-2.5 font-mono text-sm leading-relaxed text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
        />

        <div className="flex flex-wrap items-center gap-3">
          <input
            name="tags"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="Tags, comma separated"
            aria-label="Tags"
            className="min-w-48 flex-1 rounded-lg border border-control bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
          />

          <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-text-muted">
            <input
              type="checkbox"
              name="isFavorite"
              checked={isFavorite}
              onChange={(event) => setIsFavorite(event.target.checked)}
              className="size-4 accent-[var(--accent)]"
            />
            Favorite
          </label>

          <ProjectSelect projects={projects} defaultValue={initial?.projectId} />
          <CourseSelect courses={courses} defaultValue={initial?.courseId} />
        </div>

        {state && !state.success && (
          <p
            role="alert"
            className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger"
          >
            {state.error.message}
          </p>
        )}

        {state?.success && (
          <p className="text-sm text-text-muted" role="status">
            Saved and re-indexed.
          </p>
        )}

        <div className="flex items-center gap-2">
          <SaveButton label={submitLabel} />
        </div>
      </form>

      {onDelete && (
        <form action={onDelete} className="border-t border-border-subtle pt-3">
          <DeleteButton />
        </form>
      )}
    </div>
  );
}
