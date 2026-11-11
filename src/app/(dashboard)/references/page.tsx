import Link from "next/link";
import { Fragment } from "react";
import { requireUserId } from "@/lib/session";
import { apaContext, referenceApa } from "@/lib/apa";
import { listReferences } from "@/services/reference-service";
import { BibtexImport } from "@/components/bibtex-import";

export const metadata = { title: "References · Anamnesis" };

export default async function ReferencesPage() {
  const userId = await requireUserId();
  const references = await listReferences(userId);
  const ctx = apaContext(references);
  const ids = new Map(references.map((ref) => [ref.key, ref.id]));

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-text">References</h1>
          <p className="mt-1 text-sm text-text-muted">
            {references.length} {references.length === 1 ? "work" : "works"}. Cite one in a note as{" "}
            <code className="font-mono text-xs text-text">[@key]</code>, with a page as{" "}
            <code className="font-mono text-xs text-text">[@key, p. 3]</code>; the note lists them in APA 7.
          </p>
        </div>
        <Link
          href="/references/new"
          className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
        >
          Add a reference
        </Link>
      </header>

      {references.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong px-4 py-10 text-center text-sm text-text-muted">
          No references yet. Add one, or import a .bib file from Zotero, Google Scholar or Mendeley below.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface">
          {ctx.order.map((ref) => (
            <li key={ref.key}>
              <Link href={`/references/${ids.get(ref.key)}`} className="block px-4 py-3 transition-colors hover:bg-surface-subtle">
                <p className="break-words pl-8 -indent-8 font-serif text-[15px] leading-relaxed text-text">
                  {referenceApa(ctx, ref).map((part, index) =>
                    part.italic ? <i key={index}>{part.text}</i> : <Fragment key={index}>{part.text}</Fragment>,
                  )}
                </p>
                <p className="mt-1 font-mono text-xs text-text-muted">@{ref.key}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-2 mt-8 text-xs font-semibold text-text-faint">Import BibTeX</h2>
      <p className="mb-2 text-sm text-text-muted">
        Paste entries or choose a .bib file (at most 1 MB and 2,000 entries). You see what would happen first. A key you
        already have is never overwritten.
      </p>
      <BibtexImport />
    </div>
  );
}
