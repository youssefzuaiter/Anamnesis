import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { requireUserId } from "@/lib/session";
import { AppError } from "@/lib/api-response";
import { apaContext, inTextApa, referenceApa } from "@/lib/apa";
import { toBibtex } from "@/lib/bibtex";
import { getReference, listReferences, notesCiting } from "@/services/reference-service";
import { deleteReferenceAction } from "@/actions/references";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";

export const metadata = { title: "Reference · Anamnesis" };

export default async function ReferencePage({ params }: PageProps<"/references/[id]">) {
  const userId = await requireUserId();
  const { id } = await params;
  let reference;
  try {
    reference = await getReference(userId, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "RESOURCE_NOT_FOUND") notFound();
    throw error;
  }
  // The year's letter (2021a) depends on the account's other works, so the entry is formatted among them.
  const [all, citing] = await Promise.all([listReferences(userId), notesCiting(userId, reference.key)]);
  const ctx = apaContext(all);
  const item = { key: reference.key, prefix: "", locator: "", suppressAuthor: false };

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <Link href="/references" className="text-sm text-text-muted transition-colors hover:text-text">
          ← References
        </Link>
        <h1 className="mt-2 break-words text-2xl font-semibold tracking-tight text-text">{reference.title}</h1>
        <p className="mt-1 font-mono text-sm text-text-muted">@{reference.key}</p>
      </header>

      <section aria-label="APA reference" className="rounded-xl border border-border-subtle bg-surface p-4">
        <p className="break-words pl-8 -indent-8 font-serif text-[16px] leading-relaxed text-text">
          {referenceApa(ctx, reference).map((part, index) =>
            part.italic ? <i key={index}>{part.text}</i> : <Fragment key={index}>{part.text}</Fragment>,
          )}
        </p>
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          <dt className="text-text-muted">In the text</dt>
          <dd className="break-words text-text">
            {inTextApa(ctx, [item], false)} or {inTextApa(ctx, [item], true)}
          </dd>
          <dt className="text-text-muted">Write</dt>
          <dd className="break-words font-mono text-xs text-text">
            [@{reference.key}] or [@{reference.key}, p. 3] or @{reference.key}
          </dd>
        </dl>
      </section>

      <div className="mt-3 flex flex-wrap items-center gap-1">
        <Link href={`/references/${reference.id}/edit`} className="rounded-lg px-3 py-2 text-sm text-text-muted transition-colors hover:bg-surface-subtle hover:text-text">
          Edit
        </Link>
        <ConfirmDeleteButton
          action={deleteReferenceAction.bind(null, reference.id)}
          label="Delete reference"
          confirmText={`Delete @${reference.key}? Notes that cite it keep the citation, shown as not found.`}
        />
      </div>

      <h2 className="mb-2 mt-6 text-xs font-semibold text-text-faint">Cited in</h2>
      {citing.length === 0 ? (
        <p className="text-sm text-text-muted">No note cites it yet.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {citing.map((note) => (
            <li key={note.id}>
              <Link href={`/notes/${note.id}`} className="break-words text-accent-ink hover:underline">
                {note.title}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-2 mt-6 text-xs font-semibold text-text-faint">BibTeX</h2>
      <pre className="overflow-x-auto rounded-lg bg-surface-subtle p-4 font-mono text-xs leading-relaxed text-text">
        {reference.bibtex ?? toBibtex(reference)}
      </pre>
    </div>
  );
}
