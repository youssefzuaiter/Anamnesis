import { requireUserId } from "@/lib/session";
import { listDue, countCards } from "@/repositories/flashcard-repository";
import { CardReview } from "@/components/card-review";

export const metadata = { title: "Cards · Anamnesis" };

export default async function CardsPage() {
  const userId = await requireUserId();
  const now = new Date();

  const [due, counts] = await Promise.all([
    listDue(userId, now),
    countCards(userId, now),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Cards</h1>
        <p className="mt-1 text-sm text-text-muted">
          {counts.due} due of {counts.total}
          {counts.total === 1 ? " card" : " cards"}. Make cards from any note
          with enough content — open a note and use “Make cards”.
        </p>
      </header>

      <CardReview
        queue={due.map((card) => ({
          id: card.id,
          question: card.question,
          answer: card.answer,
          noteId: card.noteId,
        }))}
      />
    </div>
  );
}
