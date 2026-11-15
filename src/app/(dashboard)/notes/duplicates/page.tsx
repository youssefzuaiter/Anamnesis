import Link from "next/link";
import { requireUserId } from "@/lib/session";
import { listDuplicates } from "@/services/duplicate-service";
import { DuplicateList, type PairView } from "@/components/duplicate-pair";

export const metadata = { title: "Duplicate notes · Anamnesis" };

const EDITED = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function DuplicatesPage() {
  const userId = await requireUserId();
  const overview = await listDuplicates(userId);

  const pairs: PairView[] = overview.pairs.map((pair) => {
    const view = (note: typeof pair.a, lacks: number) => ({
      id: note.id,
      title: note.title,
      editedAt: note.updatedAt.getTime(),
      edited: EDITED.format(note.updatedAt),
      words: note.words,
      tags: note.tags,
      excerpt: note.excerpt,
      lacks,
    });
    return {
      key: pair.key,
      kind: pair.kind,
      similarity: pair.similarity,
      suggestedKeepId: pair.suggestedKeepId,
      // `lacks` on a note is what the OTHER note would add if this one were kept.
      notes: [view(pair.a, pair.bLacks), view(pair.b, pair.aLacks)],
    };
  });

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/notes" className="text-sm text-text-muted transition-colors hover:text-text">
        ← Notes
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-text">Duplicate notes</h1>
      <p className="mt-1 max-w-[68ch] text-sm text-text-muted">
        Pairs of notes that look like one note written twice. Nothing changes until you choose: merge keeps one note, adds to it
        anything the other says that it does not, moves the other&apos;s tasks, flashcards, attachments and links, and puts the
        other in the trash. Or keep both, and the pair is not offered again.
      </p>
      {!overview.searchedByMeaning && (
        <p role="note" className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          Notes could not be compared by meaning (the search index is not available), so only notes with identical text are shown.
        </p>
      )}

      <DuplicateList
        pairs={pairs}
        empty={
          <p className="mt-8 rounded-xl border border-border-subtle bg-surface p-4 text-sm text-text-muted">
          No duplicates found. Notes are compared by what they are about, using the search index, so a note saved while the local model was stopped is not
          compared until you rebuild the index in{" "}
          <Link href="/settings" className="text-accent hover:underline">
            Settings
          </Link>
          .
        </p>
        }
      />
      {overview.more > 0 && (
        <p className="mt-4 text-sm text-text-muted">{overview.more.toLocaleString("en-US")} more pairs are not shown. Deal with these and come back.</p>
      )}
    </div>
  );
}
