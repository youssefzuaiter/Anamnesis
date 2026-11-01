import Link from "next/link";
import type { DeckSummary } from "@/services/flashcard-service";

const plural = (n: number) => `${n} ${n === 1 ? "card" : "cards"}`;

/**
 * The decks you can review: all of them, each course that has cards, and the cards in no
 * course. `active` is a course id, "none", or null for all decks. The links change the
 * address, so a deck can be bookmarked and the back button works.
 */
export function DeckNav({
  decks,
  active,
  all,
}: {
  decks: DeckSummary[];
  active: string | null;
  all: { total: number; due: number };
}) {
  const items = [
    { key: null, label: "All decks", title: null, href: "/cards", ...all },
    ...decks.map((deck) => ({
      key: deck.id ?? "none",
      label: deck.label,
      title: deck.title,
      href: `/cards?course=${deck.id ?? "none"}`,
      total: deck.total,
      due: deck.due,
    })),
  ];

  return (
    <nav aria-label="Decks" className="mb-5">
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => {
          const current = item.key === active;
          return (
            <li key={item.key ?? "all"} className="max-w-full">
              <Link
                href={item.href}
                title={item.title ?? undefined}
                aria-current={current ? "page" : undefined}
                className={`inline-flex min-h-11 max-w-full flex-wrap items-center gap-x-2 rounded-lg border px-3 py-1 text-sm transition-colors ${
                  current
                    ? "border-accent bg-accent-soft text-accent-ink"
                    : "border-control text-text hover:bg-surface-subtle"
                }`}
              >
                <span className="break-all font-semibold">{item.label}</span>
                <span className="text-xs tabular-nums text-text-muted">
                  {item.due} due · {plural(item.total)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
