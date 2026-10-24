"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  bulkAssignCourseAction,
  bulkAssignProjectAction,
  bulkTagAction,
  bulkDeleteNotesAction,
} from "@/actions/bulk";
import type { ProjectOption } from "@/lib/domain";
import type { CourseOption } from "@/components/course-select";

/**
 * Appears only when something is selected. Selection itself lives in the
 * parent list, so this bar stays a pure control surface.
 */
export function NoteBulkBar({
  selected,
  courses,
  projects,
  onDone,
}: {
  selected: string[];
  courses: CourseOption[];
  projects: ProjectOption[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tag, setTag] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  // Kept mounted while there's a message to show, even once selection is
  // empty — otherwise a delete's own onDone() (see below) would unmount this
  // component in the same render that sets the message, so "Moved N notes to
  // the trash" would never actually appear on screen.
  if (selected.length === 0 && !message) return null;

  /**
   * `afterSuccess` defaults to a no-op rather than clearing the selection: a
   * tag or course/project assignment leaves the same notes selected and
   * visible, so there's no reason to lose the selection just because one
   * action on it succeeded — the user may well want to apply a second one
   * to the same set. Delete is the one action that removes the notes from
   * the list entirely, so only it passes `onDone`.
   */
  function run(
    work: () => Promise<{ message: string } | { error: string }>,
    afterSuccess: () => void = () => {},
  ) {
    setMessage(null);
    startTransition(async () => {
      const result = await work();
      if ("error" in result) {
        setMessage(result.error);
        return;
      }
      setMessage(result.message);
      afterSuccess();
      router.refresh();
    });
  }

  const select =
    "rounded-lg border border-border-subtle bg-surface-subtle px-2.5 py-1.5 text-sm text-text focus:border-accent focus:outline-none";

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent bg-accent-soft px-3 py-2.5">
      <span className="text-sm font-medium text-accent">
        {selected.length} selected
      </span>

      {courses.length > 0 && (
        <select
          disabled={pending}
          defaultValue=""
          aria-label="Assign to course"
          className={select}
          onChange={(event) => {
            const value = event.target.value;
            event.target.value = "";
            if (!value) return;
            run(async () => {
              const result = await bulkAssignCourseAction(
                selected,
                value === "none" ? null : value,
              );
              return result.success
                ? { message: `Moved ${result.data.changed} notes.` }
                : { error: result.error.message };
            });
          }}
        >
          <option value="">Course…</option>
          <option value="none">No course</option>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.code}
            </option>
          ))}
        </select>
      )}

      {projects.length > 0 && (
        <select
          disabled={pending}
          defaultValue=""
          aria-label="Assign to project"
          className={select}
          onChange={(event) => {
            const value = event.target.value;
            event.target.value = "";
            if (!value) return;
            run(async () => {
              const result = await bulkAssignProjectAction(
                selected,
                value === "none" ? null : value,
              );
              return result.success
                ? { message: `Moved ${result.data.changed} notes.` }
                : { error: result.error.message };
            });
          }}
        >
          <option value="">Project…</option>
          <option value="none">No project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        </select>
      )}

      <div className="flex items-center gap-1">
        <input
          value={tag}
          disabled={pending}
          placeholder="add tag"
          aria-label="Tag to add"
          onChange={(event) => setTag(event.target.value)}
          className="w-28 rounded-lg border border-control bg-surface px-2.5 py-1.5 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          disabled={pending || !tag.trim()}
          onClick={() =>
            run(async () => {
              const result = await bulkTagAction(selected, tag);
              if (!result.success) return { error: result.error.message };
              setTag("");
              return { message: `Tagged ${result.data.changed} notes.` };
            })
          }
          className="rounded-lg border border-border-subtle px-2.5 py-1.5 text-sm text-text transition-colors hover:bg-surface disabled:opacity-60"
        >
          Tag
        </button>
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Move ${selected.length} notes to the trash?`)) return;
          run(async () => {
            const result = await bulkDeleteNotesAction(selected);
            return result.success
              ? { message: `Moved ${result.data.deleted} notes to the trash.` }
              : { error: result.error.message };
          }, onDone);
        }}
        className="rounded-lg px-2.5 py-1.5 text-sm text-text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-60"
      >
        Delete
      </button>

      <button
        type="button"
        onClick={onDone}
        className="ml-auto text-sm text-text-muted hover:text-text"
      >
        Clear
      </button>

      {message && <p className="w-full text-xs text-text-muted">{message}</p>}
    </div>
  );
}
