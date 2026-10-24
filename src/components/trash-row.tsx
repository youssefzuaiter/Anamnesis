"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { restoreAction, purgeAction } from "@/actions/trash";
import type { TrashKind } from "@/lib/domain";

export function TrashRow({
  kind,
  id,
  title,
  deletedAt,
}: {
  kind: TrashKind;
  id: string;
  title: string;
  deletedAt: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: typeof restoreAction) {
    setError(null);
    startTransition(async () => {
      const result = await action({ kind, id });
      if (!result.success) {
        setError(result.error.message);
        return;
      }
      // Called from a click handler rather than a <form>, so revalidatePath
      // alone leaves this already-rendered list showing the row that just
      // left the trash. Same reason calendar-dnd.tsx refreshes after a drop.
      router.refresh();
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-2.5">
      <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-xs text-text-muted">
        {kind}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-text">{title}</span>
      <span className="text-xs text-text-muted">{deletedAt}</span>

      <button
        type="button"
        disabled={pending}
        onClick={() => run(restoreAction)}
        className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-text transition-colors hover:bg-surface-subtle disabled:opacity-60"
      >
        Restore
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm(`Permanently delete “${title}”? This cannot be undone.`)) {
            run(purgeAction);
          }
        }}
        className="rounded-lg px-3 py-1.5 text-sm text-text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-60"
      >
        Delete forever
      </button>

      {error && (
        <p role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
