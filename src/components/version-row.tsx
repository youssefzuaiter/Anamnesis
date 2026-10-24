"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { restoreVersionAction } from "@/actions/versions";

export function VersionRow({
  id,
  title,
  when,
  length,
}: {
  id: string;
  title: string;
  when: string;
  length: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-2.5">
      <span className="min-w-0 flex-1 truncate text-sm text-text">{title}</span>
      <span className="shrink-0 text-xs text-text-muted">{when}</span>
      <span className="shrink-0 text-xs tabular-nums text-text-muted">
        {length.toLocaleString()} chars
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (
            !confirm(
              "Restore this version? The current text is saved as a version first, so this is undoable.",
            )
          ) {
            return;
          }
          setError(null);
          startTransition(async () => {
            const result = await restoreVersionAction(id);
            if (result.success) router.push(`/notes/${result.data.noteId}`);
            else setError(result.error.message);
          });
        }}
        className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-text transition-colors hover:bg-surface-subtle disabled:opacity-60"
      >
        {pending ? "Restoring…" : "Restore"}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
