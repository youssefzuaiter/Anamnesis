"use client";

import { useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import type { ApiResponse } from "@/lib/api-response";
import {
  uploadAttachmentAction,
  deleteAttachmentAction,
} from "@/actions/attachments";

export type AttachmentRow = {
  id: string;
  filename: string;
  mimeType: string;
  size: string;
  isImage: boolean;
};

function UploadButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg border border-border-subtle px-3.5 py-2 text-sm text-text transition-colors hover:bg-surface-subtle disabled:opacity-60"
    >
      {pending ? "Attaching…" : "Attach"}
    </button>
  );
}

export function NoteAttachments({
  noteId,
  attachments,
}: {
  noteId: string;
  attachments: AttachmentRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, formAction] = useActionState<ApiResponse<null> | null, FormData>(
    uploadAttachmentAction.bind(null, noteId),
    null,
  );

  return (
    <section>
      <h2 className="mb-1.5 text-xs font-semibold text-text-faint">
        Attachments
      </h2>

      {attachments.length > 0 && (
        <ul className="mb-3 flex flex-col gap-2">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-3 rounded-lg border border-border-subtle px-3 py-2"
            >
              {attachment.isImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/attachments/${attachment.id}`}
                  alt=""
                  className="size-10 shrink-0 rounded object-cover"
                />
              )}
              <a
                href={`/api/attachments/${attachment.id}`}
                className="min-w-0 flex-1 truncate text-sm text-accent hover:underline"
              >
                {attachment.filename}
              </a>
              <span className="shrink-0 text-xs text-text-muted">
                {attachment.size}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!confirm(`Remove “${attachment.filename}”?`)) return;
                  startTransition(async () => {
                    await deleteAttachmentAction(attachment.id);
                    router.refresh();
                  });
                }}
                className="shrink-0 text-xs text-text-muted transition-colors hover:text-danger disabled:opacity-60"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          name="file"
          required
          aria-label="File to attach"
          accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv"
          className="max-w-full rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2 text-sm text-text file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent"
        />
        <UploadButton />
      </form>

      {state && !state.success && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {state.error.message}
        </p>
      )}
    </section>
  );
}
