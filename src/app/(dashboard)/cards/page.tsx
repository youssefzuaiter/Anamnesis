import { z } from "zod";
import { requireUserId } from "@/lib/session";
import { spreadSiblings } from "@/lib/cloze";
import { listDue } from "@/repositories/flashcard-repository";
import { listDecks } from "@/services/flashcard-service";
import { CardReview } from "@/components/card-review";
import { DeckNav } from "@/components/deck-nav";

export const metadata = { title: "Cards · Anamnesis" };

/** A session is at most this many cards; more are fetched so held-back siblings do not shrink it. */
const SESSION_SIZE = 50;
const FETCH_SIZE = 200;

// Only a plain string that is a course id or "none" names a deck. Anything else, a repeated
// parameter included, is all decks. A course id that is not the caller's is a deck with
// nothing in it: it is only ever used inside a query for the caller's own cards.
const deckParam = z.union([z.literal("none"), z.uuid()]);

export default async function CardsPage({ searchParams }: PageProps<"/cards">) {
  const userId = await requireUserId();
  const params = await searchParams;
  const parsed = deckParam.safeParse(params.course);
  const deck = parsed.success ? parsed.data : null;
  const now = new Date();

  const [decks, due] = await Promise.all([
    listDecks(userId, now),
    listDue(userId, now, { deck: deck ?? undefined, take: FETCH_SIZE }),
  ]);

  const all = decks.reduce(
    (sum, d) => ({ total: sum.total + d.total, due: sum.due + d.due }),
    { total: 0, due: 0 },
  );
  const counts =
    deck === null ? all : (decks.find((d) => (d.id ?? "none") === deck) ?? { total: 0, due: 0 });
  const { session, held } = spreadSiblings(due);

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Cards</h1>
        <p className="mt-1 text-sm text-text-muted">
          {counts.due} due of {counts.total}
          {counts.total === 1 ? " card" : " cards"}. Make cards from any note: open it and use
          “Make cards”, or write your own with “New card”.
        </p>
      </header>

      <DeckNav decks={decks} active={deck} all={all} />

      {held > 0 && (
        <p className="mb-3 text-xs text-text-muted">
          {held} more {held === 1 ? "card" : "cards"} from the same text{" "}
          {held === 1 ? "waits" : "wait"} for your next session.
        </p>
      )}

      <CardReview
        key={deck ?? "all"}
        queue={session.slice(0, SESSION_SIZE).map((card) => ({
          id: card.id,
          question: card.question,
          answer: card.answer,
          noteId: card.noteId,
          clozeIndex: card.clozeIndex,
        }))}
      />
    </div>
  );
}
