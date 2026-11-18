import Link from "next/link";
import { requireUserId } from "@/lib/session";
import { BROWSE_PAGE_SIZE, browseHref, dueLabel, kindLabel, parseBrowseParams } from "@/lib/card-browser";
import { browseCards, listDecks } from "@/services/flashcard-service";
import { CardBrowserRow } from "@/components/card-browser-row";

export const metadata = { title: "All cards · Anamnesis" };

const FIELD =
  "min-h-11 w-full rounded-lg border border-control bg-surface px-3 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none sm:min-h-10";

const SHOWS = [
  ["due", "Due now"],
  ["later", "Not due yet"],
  ["weak", "Weak spots"],
  ["new", "Never reviewed"],
] as const;

/**
 * Every card, searchable and editable (ROADMAP item 47). The filters are a plain GET form, so a view is a link that can be bookmarked and
 * works without scripts; the address is read as plain values only (`parseBrowseParams`), never as a list of cards.
 */
export default async function AllCardsPage({ searchParams }: PageProps<"/cards/all">) {
  const userId = await requireUserId();
  const params = parseBrowseParams(await searchParams);
  const now = new Date();
  const [decks, result] = await Promise.all([listDecks(userId, now), browseCards(userId, params, now)]);

  const filtered = params.q !== "" || params.deck !== null || params.kind !== null || params.show !== null;
  const deckName = params.deck === null ? null : (decks.find((d) => (d.id ?? "none") === params.deck)?.label ?? "that deck");
  const where = [params.q !== "" ? `“${params.q}”` : null, deckName ? `in ${deckName}` : null].filter(Boolean).join(" ");
  const summary = filtered
    ? `${result.total} ${result.total === 1 ? "card matches" : "cards match"}${where ? ` ${where}` : ""}.`
    : `${result.total} ${result.total === 1 ? "card" : "cards"}.`;
  const first = (result.page - 1) * BROWSE_PAGE_SIZE + 1;

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-text">All cards</h1>
        <p className="mt-1 text-sm text-text-muted">
          <Link href="/cards" className="font-semibold text-accent-ink underline-offset-2 hover:underline">Back to review</Link>
        </p>
      </header>

      <form action="/cards/all" method="get" className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_repeat(3,auto)] sm:items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-[13px] font-semibold text-text">Search the text of cards</label>
          <input id="q" name="q" type="search" defaultValue={params.q} maxLength={200} className={FIELD} />
        </div>
        <div className="grid grid-cols-3 gap-2 sm:contents">
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="deck" className="text-[13px] font-semibold text-text">Deck</label>
            <select id="deck" name="deck" defaultValue={params.deck ?? ""} className={FIELD}>
              <option value="">All decks</option>
              {decks.map((d) => <option key={d.id ?? "none"} value={d.id ?? "none"}>{d.label}</option>)}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="kind" className="text-[13px] font-semibold text-text">Kind</label>
            <select id="kind" name="kind" defaultValue={params.kind ?? ""} className={FIELD}>
              <option value="">All kinds</option>
              <option value="basic">Basic</option>
              <option value="cloze">Fill in the blank</option>
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="show" className="text-[13px] font-semibold text-text">Show</label>
            <select id="show" name="show" defaultValue={params.show ?? ""} className={FIELD}>
              <option value="">Everything</option>
              {SHOWS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2 sm:col-span-4">
          <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover sm:min-h-9">
            Search
          </button>
          {filtered && (
            <Link href="/cards/all" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border-strong px-4 text-sm font-semibold text-text transition-colors hover:bg-surface-subtle sm:min-h-9">
              Clear
            </Link>
          )}
        </div>
      </form>

      <p role="status" className="mb-3 text-[13px] text-text-muted">{summary}</p>

      {result.cards.length === 0 ? (
        <p className="rounded-xl border border-border-subtle bg-surface p-6 text-sm text-text-muted">
          {filtered ? "No card matches. Search looks for your words exactly, in the question and the answer." : "You have no cards yet. Make them from a note: open it and use “Make cards”."}
        </p>
      ) : (
        <ul className="divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface">
          {result.cards.map(({ card, courseCode, siblingCount, fails }) => (
            <CardBrowserRow
              key={card.id}
              card={{
                id: card.id,
                question: card.question,
                answer: card.answer,
                clozeIndex: card.clozeIndex,
                siblingCount,
                courseCode,
                kind: kindLabel(card.clozeIndex, siblingCount),
                due: dueLabel(card.dueAt, now),
                weak: fails === null ? null : `Weak: failed ${fails} times this month`,
              }}
            />
          ))}
        </ul>
      )}

      {result.pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3 text-sm">
          {result.page > 1 ? (
            <Link href={browseHref({ ...params, page: result.page - 1 })} className="inline-flex min-h-11 items-center rounded-lg border border-border-strong px-4 font-semibold text-text hover:bg-surface-subtle sm:min-h-9">Previous</Link>
          ) : <span />}
          <span className="text-text-muted">Cards {first} to {first + result.cards.length - 1} of {result.total}</span>
          {result.page < result.pages ? (
            <Link href={browseHref({ ...params, page: result.page + 1 })} className="inline-flex min-h-11 items-center rounded-lg border border-border-strong px-4 font-semibold text-text hover:bg-surface-subtle sm:min-h-9">Next</Link>
          ) : <span />}
        </nav>
      )}
    </div>
  );
}
