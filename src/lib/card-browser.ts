import { answerFor, validateCloze } from "@/lib/cloze";
import { MAX_CARD_ANSWER, MAX_CARD_QUESTION } from "@/lib/domain";

export const BROWSE_PAGE_SIZE = 50;
export const MAX_QUERY = 200;

export const BROWSE_KINDS = ["basic", "cloze"] as const;
export const BROWSE_SHOWS = ["due", "later", "weak", "new"] as const;
export type BrowseKind = (typeof BROWSE_KINDS)[number];
export type BrowseShow = (typeof BROWSE_SHOWS)[number];

export type BrowseParams = {
  q: string;
  /** A course id, "none" for cards without a course, or null for every deck. */
  deck: string | null;
  kind: BrowseKind | null;
  show: BrowseShow | null;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A parameter counts only when it was given exactly once. */
function single(raw: RawParams, key: string): string | undefined {
  const value = raw[key];
  return typeof value === "string" ? value : undefined;
}

export function parseBrowseParams(raw: RawParams): BrowseParams {
  const q = (single(raw, "q") ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);
  const deckRaw = single(raw, "deck");
  const deck = deckRaw === "none" || (deckRaw !== undefined && UUID.test(deckRaw)) ? deckRaw! : null;
  const kindRaw = single(raw, "kind");
  const kind = BROWSE_KINDS.find((k) => k === kindRaw) ?? null;
  const showRaw = single(raw, "show");
  const show = BROWSE_SHOWS.find((s) => s === showRaw) ?? null;
  const pageRaw = single(raw, "page");
  const page = pageRaw !== undefined && /^[1-9]\d{0,5}$/.test(pageRaw) ? Number(pageRaw) : 1;
  return { q, deck, kind, show, page };
}

/** An address for a view, holding only what differs from the default. */
export function browseHref(params: Partial<BrowseParams>): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.deck) search.set("deck", params.deck);
  if (params.kind) search.set("kind", params.kind);
  if (params.show) search.set("show", params.show);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const text = search.toString();
  return text ? `/cards/all?${text}` : "/cards/all";
}

const dayNumber = (d: Date) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);

export function dueLabel(dueAt: Date, now: Date): string {
  if (dueAt.getTime() <= now.getTime()) return "Due now";
  const days = dayNumber(dueAt) - dayNumber(now);
  if (days <= 0) return "Due later today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

export function kindLabel(clozeIndex: number | null, siblingCount: number): string {
  return clozeIndex === null ? "Basic" : `Fill in the blank (${clozeIndex} of ${siblingCount})`;
}

type EditCard = { id: string; clozeIndex: number | null };
export type EditInput = { question?: unknown; answer?: unknown; text?: unknown };
export type EditPlan = { ok: true; updates: { id: string; question: string; answer: string }[] } | { ok: false; message: string };

const refuse = (message: string): EditPlan => ({ ok: false, message });
const KEEP = "Keep the same blanks, or delete these cards and make new ones.";

/** What an edit would write: only words change, never the schedule, the note or the deck. */
export function planCardEdit(card: EditCard, siblings: EditCard[], input: EditInput): EditPlan {
  if (card.clozeIndex === null) {
    if (input.text !== undefined) return refuse("This is a basic card: edit its question and answer.");
    const question = typeof input.question === "string" ? input.question.trim() : "";
    const answer = typeof input.answer === "string" ? input.answer.trim() : "";
    if (question === "") return refuse("Write the question first.");
    if (question.length > MAX_CARD_QUESTION) return refuse(`The question can be at most ${MAX_CARD_QUESTION} characters.`);
    if (answer === "") return refuse("Write the answer first.");
    if (answer.length > MAX_CARD_ANSWER) return refuse(`The answer can be at most ${MAX_CARD_ANSWER} characters.`);
    return { ok: true, updates: [{ id: card.id, question, answer }] };
  }

  if (input.question !== undefined || input.answer !== undefined) return refuse("This is a fill-in-the-blank card: edit its text.");
  if (typeof input.text !== "string") return refuse("Write the text first.");
  const check = validateCloze(input.text);
  if (!check.ok) return refuse(check.message);

  const have = new Set(siblings.map((s) => s.clozeIndex).filter((n): n is number => n !== null));
  const want = new Set(check.numbers);
  const added = check.numbers.filter((n) => !have.has(n));
  const removed = [...have].filter((n) => !want.has(n)).sort((a, b) => a - b);
  if (removed.length > 0) return refuse(`That would remove blank ${removed[0]}. ${KEEP}`);
  if (added.length > 0) return refuse(`That would add a blank (${added[0]}). ${KEEP}`);

  return {
    ok: true,
    updates: siblings.map((s) => ({ id: s.id, question: check.text, answer: answerFor(check.text, s.clozeIndex as number) })),
  };
}
