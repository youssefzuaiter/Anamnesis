import Link from "next/link";
import { z } from "zod";
import { requireUserId } from "@/lib/session";
import { spreadSiblings } from "@/lib/cloze";
import { listDue } from "@/repositories/flashcard-repository";
import { listCram, listDecks, listWeakSpots } from "@/services/flashcard-service";
import { CRAM_SESSION, cramReason } from "@/lib/cram";
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
  // "?weak=1" is the weak-spots deck (ROADMAP item 42); any other value of it is the ordinary queue.
  const weakOpen = params.weak === "1";
  // "?course=<id>&cram=1" is that course's cram deck (item 48): every card of it, weakest first, due or not. It needs a course id.
  const cramOpen = params.cram === "1" && deck !== null && deck !== "none" && !weakOpen;
  const now = new Date();

  const [decks, weakCards, due, cram] = await Promise.all([
    listDecks(userId, now),
    listWeakSpots(userId, now),
    weakOpen || cramOpen ? Promise.resolve([]) : listDue(userId, now, { deck: deck ?? undefined, take: FETCH_SIZE }),
    cramOpen ? listCram(userId, deck as string, now) : Promise.resolve(null),
  ]);
  const queueCards = cram ? cram.items.map((item) => item.card) : weakOpen ? weakCards.map((weak) => weak.card).slice(0, FETCH_SIZE) : due;
  const reasons = new Map(cram?.items.map((item) => [item.card.id, cramReason(item.entry)]));
  const cramDeck = cramOpen ? decks.find((d) => d.id === deck) : undefined;

  const all = decks.reduce(
    (sum, d) => ({ total: sum.total + d.total, due: sum.due + d.due }),
    { total: 0, due: 0 },
  );
  const counts =
    deck === null ? all : (decks.find((d) => (d.id ?? "none") === deck) ?? { total: 0, due: 0 });
  const { session, held } = spreadSiblings(queueCards);

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Cards</h1>
        <p className="mt-1 text-sm text-text-muted">
          {cram
            ? `Cramming ${cramDeck?.label ?? "this course"}: ${cram.items.length} ${cram.items.length === 1 ? "card" : "cards"}, weakest first, whether or not they are due. Grading works as it always does; nothing is rescheduled just for being here.${cram.items.length > CRAM_SESSION ? ` A session is the first ${CRAM_SESSION}; open Cram again to rebuild it from your latest answers.` : ""}`
            : weakOpen
            ? `${weakCards.length} ${weakCards.length === 1 ? "card" : "cards"} you got wrong at least twice in the last 30 days and have not got right twice since, worst first. Grading them works as it always does; nothing is rescheduled just for being here.`
            : `${counts.due} due of ${counts.total} ${counts.total === 1 ? "card" : "cards"}. Make cards from any note: open it and use “Make cards”, or write your own with “New card”.`}
        </p>
      </header>

      <p className="mb-3 text-sm">
        <Link href="/cards/all" className="font-semibold text-accent-ink underline-offset-2 hover:underline">Browse and edit all cards</Link>
      </p>

      <DeckNav decks={decks} active={deck} all={all} weak={{ count: weakCards.length, open: weakOpen }} cram={cram ? { label: cramDeck?.label ?? "course", count: cram.items.length, href: `/cards?course=${deck}&cram=1` } : null} />

      {held > 0 && (
        <p className="mb-3 text-xs text-text-muted">
          {held} more {held === 1 ? "card" : "cards"} from the same text{" "}
          {held === 1 ? "waits" : "wait"} for your next session.
        </p>
      )}

      <CardReview
        weak={weakOpen}
        cram={cramOpen}
        key={cramOpen ? `cram-${deck}` : weakOpen ? "weak" : (deck ?? "all")}
        queue={session.slice(0, cramOpen ? CRAM_SESSION : SESSION_SIZE).map((card) => ({
          id: card.id,
          question: card.question,
          answer: card.answer,
          noteId: card.noteId,
          clozeIndex: card.clozeIndex,
          reason: reasons.get(card.id) ?? null,
        }))}
      />
    </div>
  );
}
