"use client";

import Link from "next/link";
import { useState } from "react";
import { NoteBulkBar } from "@/components/note-bulk-bar";
import type { ProjectOption } from "@/lib/domain";
import type { CourseOption } from "@/components/course-select";

export type NoteCard = {
  id: string;
  title: string;
  excerpt: string;
  tags: string[];
  isFavorite: boolean;
  updated: string;
};

export function NoteGrid({
  notes,
  courses,
  projects,
}: {
  notes: NoteCard[];
  courses: CourseOption[];
  projects: ProjectOption[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <NoteBulkBar
        selected={[...selected]}
        courses={courses}
        projects={projects}
        onDone={() => setSelected(new Set())}
      />

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {notes.map((note) => {
          const checked = selected.has(note.id);
          return (
            <li key={note.id} className="relative">
              {/* Outside the Link, so ticking a note never navigates to it. */}
              <input
                type="checkbox"
                checked={checked}
                aria-label={`Select ${note.title}`}
                onChange={() => toggle(note.id)}
                className="absolute right-3 top-3 z-10 size-4 accent-[var(--accent)]"
              />
              <Link
                href={`/notes/${note.id}`}
                className={`block rounded-xl border bg-surface p-4 pr-10 shadow-card transition-colors ${
                  checked
                    ? "border-accent ring-1 ring-accent"
                    : "border-border-subtle hover:border-border-strong"
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="truncate font-semibold text-text">
                    {note.isFavorite && (
                      <>
                        <span aria-hidden="true" className="mr-1.5 text-accent-ink">
                          ★
                        </span>
                        <span className="sr-only">Favourite: </span>
                      </>
                    )}
                    {note.title}
                  </h2>
                </div>
                <p className="text-xs text-text-faint">{note.updated}</p>
                {note.excerpt && (
                  <p className="mt-1 line-clamp-2 text-sm text-text-muted">
                    {note.excerpt}
                  </p>
                )}
                {note.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {note.tags.map((name) => (
                      <span
                        key={name}
                        className="rounded-full bg-surface-subtle px-2 py-0.5 text-xs text-text-muted"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
