"use client";

import { useState, type ReactNode } from "react";
import { NoteContent } from "@/components/note-content";

/**
 * Reading is the default; editing is the deliberate act. The editor is only
 * mounted once you switch to it, so the rendered view costs nothing extra.
 */
export function NoteView({
  header,
  content,
  links,
  editor,
}: {
  /** The title and its metadata, shown while reading; the editor has its
   *  own title field, so showing both would repeat it. */
  header?: ReactNode;
  content: string;
  links: Record<string, string | null>;
  editor: ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              if (
                confirm("Leave the editor? Anything unsaved will be lost.")
              ) {
                setEditing(false);
              }
            }}
            className="inline-flex min-h-9 items-center rounded-lg border border-border-strong px-3.5 text-sm font-semibold text-text-muted transition-colors hover:text-text"
          >
            Done
          </button>
        </div>
        {editor}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">{header}</div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex min-h-9 shrink-0 items-center rounded-lg border border-border-strong px-3.5 text-sm font-semibold text-text transition-colors hover:bg-surface-subtle"
        >
          Edit
        </button>
      </div>

      {content.trim() ? (
        <NoteContent content={content} links={links} />
      ) : (
        <p className="text-sm text-text-muted">
          This note is empty. Use Edit to write something.
        </p>
      )}
    </div>
  );
}
