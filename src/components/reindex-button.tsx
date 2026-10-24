"use client";

import { useState, useTransition } from "react";
import { reindexAction } from "@/actions/reindex";

export function ReindexButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await reindexAction();
            setMessage(
              result.success
                ? `Rebuilt ${result.data.indexed} items${
                    result.data.failed > 0
                      ? `, ${result.data.failed} could not be embedded`
                      : ""
                  }.`
                : result.error.message,
            );
          });
        }}
        className="rounded-lg border border-border-subtle px-3.5 py-2 text-sm text-text transition-colors hover:bg-surface-subtle disabled:opacity-60"
      >
        {pending ? "Rebuilding…" : "Rebuild search index"}
      </button>
      {message && <p className="text-xs text-text-muted">{message}</p>}
    </div>
  );
}
