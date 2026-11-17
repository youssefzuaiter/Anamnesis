import Link from "next/link";
import { Fragment } from "react";
import { requireUserId } from "@/lib/session";
import { apaContext, referenceApa } from "@/lib/apa";
import { citationCounts, listReferences } from "@/services/reference-service";
import { READ_STATUSES, countByStatus, parseStatusParam, readStatusLabel, type ReadStatus } from "@/lib/reading";
import { BibtexImport } from "@/components/bibtex-import";

export const metadata = { title: "References · Anamnesis" };

const CHIP: Record<ReadStatus, string> = {
  to_read: "border border-control bg-surface-subtle text-text-muted",
  reading: "bg-accent-soft text-accent-ink",
  done: "bg-ok-soft text-ok",
};

export default async function ReferencesPage({ searchParams }: PageProps<"/references">) {
  const userId = await requireUserId();
  // Only one plain status names a filter; anything else, a repeated parameter included, is every work.
  const filter = parseStatusParam((await searchParams).status);
  const references = await listReferences(userId);
  const [{ counts: cited, capped }] = await Promise.all([citationCounts(userId, references.map((ref) => ref.key))]);
  const ctx = apaContext(references);
  const ids = new Map(references.map((ref) => [ref.key, ref.id]));
  const byKey = new Map(references.map((ref) => [ref.key, ref]));
  const counts = countByStatus(references.map((ref) => ref.readStatus));
  const shown = ctx.order.filter((ref) => filter === null || byKey.get(ref.key)?.readStatus === filter);
  const tabs: { key: ReadStatus | null; label: string; count: number }[] = [
    { key: null, label: "All", count: references.length },
    ...READ_STATUSES.map((status) => ({ key: status, label: readStatusLabel(status), count: counts[status] })),
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-text">References</h1>
          <p className="mt-1 text-sm text-text-muted">
            {references.length} {references.length === 1 ? "work" : "works"}
            {counts.reading > 0 ? `. ${counts.reading} you are reading now` : ""}. Cite one in a note as{" "}
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

      {references.length > 0 && (
        <div role="group" aria-label="Reading status" className="mb-4 flex flex-wrap gap-2">
            {tabs.map((tab) => {
              const current = tab.key === filter;
              return (
                <Link
                    key={tab.key ?? "all"}
                    href={tab.key ? `/references?status=${tab.key}` : "/references"}
                    aria-current={current ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3.5 text-sm font-semibold transition-colors ${
                      current ? "border-accent bg-accent-soft text-accent-ink" : "border-control bg-surface text-text hover:bg-surface-subtle"
                    }`}
                  >
                    {tab.label} <span className="text-xs font-normal tabular-nums text-text-muted">{tab.count}</span>
                  </Link>
              );
            })}
          
        </div>
      )}

      {references.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong px-4 py-10 text-center text-sm text-text-muted">
          No references yet. Add one, or import a .bib file from Zotero, Google Scholar or Mendeley below.
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong px-4 py-10 text-center text-sm text-text-muted">
          Nothing is marked “{filter ? readStatusLabel(filter) : ""}” yet. Open a work to change its status.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface">
          {shown.map((ref) => {
            const stored = byKey.get(ref.key);
            const status = stored?.readStatus ?? "to_read";
            const count = cited.get(ref.key) ?? 0;
            return (
            <li key={ref.key}>
              <Link href={`/references/${ids.get(ref.key)}`} className="block px-4 py-3 transition-colors hover:bg-surface-subtle">
                <p className="break-words pl-8 -indent-8 font-serif text-[15px] leading-relaxed text-text">
                  {referenceApa(ctx, ref).map((part, index) =>
                    part.italic ? <i key={index}>{part.text}</i> : <Fragment key={index}>{part.text}</Fragment>,
                  )}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                  <span className={`rounded-full px-2.5 py-0.5 font-semibold ${CHIP[status]}`}>{readStatusLabel(status)}</span>
                  {stored?.takeaway && <span className="min-w-0 break-words text-text">{stored.takeaway}</span>}
                </div>
                <p className="mt-1 text-[13px] text-text-muted">
                  {count === 0 ? "Not cited yet" : `Cited in ${capped ? "at least " : ""}${count} ${count === 1 ? "note" : "notes"}`} ·{" "}
                  <span className="font-mono text-xs">@{ref.key}</span>
                </p>
              </Link>
            </li>
            );
          })}
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
