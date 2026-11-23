import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import {
  DUPLICATE_MIN_SIMILARITY,
  classifyPair,
  compareText,
  orderedPair,
  pairKey,
  planMerge,
  rewriteLinks,
  words,
  type PairKind,
} from "@/lib/duplicates";
import { MAX_NOTE_LENGTH } from "@/lib/see-also";
import { normalizeTitle } from "@/lib/wiki-links";
import * as repo from "@/repositories/duplicate-repository";
import * as noteRepository from "@/repositories/note-repository";
import * as noteService from "@/services/note-service";
import { assertNotLocked } from "@/services/note-lock-service";

/*
 * Duplicate-note cleanup (ROADMAP item 36). A pair is offered when the stored vectors say two notes are about the same thing
 * (no model call: they are already stored) or when their text is identical, and the words then say which kind it is. Nothing
 * is ever changed by looking. A merge keeps one note, adds to it whatever the other says that it does not, moves what points
 * at the other (tasks, cards, attachments, [[links]]), and puts the other in the trash, where it can be restored. It is
 * done in an order that loses nothing if it stops half-way: the kept note is written first, the other is trashed last.
 */

const MAX_PAIRS_SHOWN = 50;
const PAIR_CANDIDATES = 200;
const MAX_REFERRERS = 500;
const MAX_TAGS = 12;

export type PairNote = {
  id: string;
  title: string;
  updatedAt: Date;
  words: number;
  tags: string[];
  excerpt: string;
};

export type DuplicatePair = {
  key: string;
  a: PairNote;
  b: PairNote;
  kind: PairKind;
  /** Average-vector similarity, or null when the pair was found by identical text alone. */
  similarity: number | null;
  /** Blocks of one note that the other lacks: what keeping the other would add to it. */
  aLacks: number;
  bLacks: number;
  /** The one to keep unless the person chooses otherwise: the longer, then the more recently edited. */
  suggestedKeepId: string;
};

export type DuplicateOverview = {
  pairs: DuplicatePair[];
  /** Pairs found beyond the ones shown. */
  more: number;
  /** Notes whose vectors were compared (the newest 2,000). */
  searchedByMeaning: boolean;
};

const EXCERPT = 160;
const excerptOf = (content: string) => {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT ? `${flat.slice(0, EXCERPT).trimEnd()}…` : flat;
};

export async function listDuplicates(userId: string): Promise<DuplicateOverview> {
  assertUser(userId);
  const [pairsFound, groups, decided] = await Promise.all([
    repo.vectorPairs(userId, DUPLICATE_MIN_SIMILARITY, PAIR_CANDIDATES).catch((error) => {
      // With no vectors (the index never ran, or Ollama was down while notes were saved) the exact-text pairs still work.
      console.error("[WARN] Duplicate search by meaning unavailable:", error);
      return null;
    }),
    repo.sameTextGroups(userId),
    repo.decidedKeys(userId),
  ]);

  const candidates = new Map<string, { a: string; b: string; similarity: number | null }>();
  for (const pair of pairsFound ?? []) {
    const [a, b] = orderedPair(pair.aId, pair.bId);
    candidates.set(pairKey(a, b), { a, b, similarity: Number(pair.similarity) });
  }
  for (const ids of groups) {
    for (let index = 1; index < ids.length; index++) {
      const [a, b] = orderedPair(ids[0], ids[index]);
      const key = pairKey(a, b);
      if (!candidates.has(key)) candidates.set(key, { a, b, similarity: null });
    }
  }
  for (const key of decided) candidates.delete(key);

  const ids = [...new Set([...candidates.values()].flatMap((pair) => [pair.a, pair.b]))];
  const rows = ids.length
    ? await prisma.note.findMany({
        where: { userId, deletedAt: null, locked: false, id: { in: ids } },
        select: { id: true, title: true, content: true, tags: true, updatedAt: true },
      })
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));

  const out: DuplicatePair[] = [];
  for (const [key, candidate] of candidates) {
    const a = byId.get(candidate.a);
    const b = byId.get(candidate.b);
    if (!a || !b) continue;
    const text = compareText(a.content, b.content);
    const kind = classifyPair(candidate.similarity, text);
    if (kind === null) continue;
    const wordsA = words(a.content).length;
    const wordsB = words(b.content).length;
    const suggested = wordsA !== wordsB ? (wordsA > wordsB ? a : b) : a.updatedAt >= b.updatedAt ? a : b;
    const view = (note: typeof a, count: number): PairNote => ({
      id: note.id,
      title: note.title,
      updatedAt: note.updatedAt,
      words: count,
      tags: note.tags,
      excerpt: excerptOf(note.content),
    });
    const lacks = (keep: typeof a, other: typeof a) => {
      const plan = planMerge(keep.content, other.title, other.content);
      return plan.ok ? plan.added.length : 0;
    };
    out.push({
      key,
      a: view(a, wordsA),
      b: view(b, wordsB),
      kind,
      similarity: candidate.similarity,
      aLacks: lacks(a, b),
      bLacks: lacks(b, a),
      suggestedKeepId: suggested.id,
    });
  }
  out.sort((x, y) => (x.kind === y.kind ? (y.similarity ?? 1) - (x.similarity ?? 1) : x.kind === "same-text" ? -1 : 1));
  return { pairs: out.slice(0, MAX_PAIRS_SHOWN), more: Math.max(0, out.length - MAX_PAIRS_SHOWN), searchedByMeaning: pairsFound !== null };
}

function assertUser(userId: string): void {
  if (typeof userId !== "string" || userId === "") throw new AppError("AUTH_REQUIRED", "Sign in first.");
}

const TOO_LONG = "Together they are longer than one note can be (100,000 characters). Shorten one first.";
const NOT_FOUND = "One of those notes no longer exists.";
const ids = z.object({ a: z.uuid(), b: z.uuid() });

/** Two live notes of the caller, or the one refusal for a foreign, deleted, missing or identical id. */
async function liveNotes(userId: string, first: string, second: string) {
  if (first === second) throw new AppError("VALIDATION_ERROR", "Choose two different notes.");
  const rows = await prisma.note.findMany({ where: { userId, deletedAt: null, id: { in: [first, second] } } });
  const a = rows.find((row) => row.id === first);
  const b = rows.find((row) => row.id === second);
  if (!a || !b) throw new AppError("RESOURCE_NOT_FOUND", NOT_FOUND);
  // Merging reads and rewrites both texts, which a locked note cannot offer.
  assertNotLocked(a);
  assertNotLocked(b);
  return { a, b };
}

/** "Keep both": the pair is not offered again. */
export async function keepBoth(userId: string, input: unknown): Promise<void> {
  assertUser(userId);
  const parsed = ids.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Choose two notes.");
  const { a, b } = await liveNotes(userId, parsed.data.a, parsed.data.b);
  await repo.addDecision(userId, a.id, b.id);
}

const mergeInput = z.object({
  keepId: z.uuid(),
  dropId: z.uuid(),
  /** When each note was last edited, as shown: a note changed since is not merged on a decision made about its older text. */
  keepUpdatedAt: z.number().int(),
  dropUpdatedAt: z.number().int(),
});

export type MergeResult = { addedBlocks: number; linksRewritten: number; tasks: number; cards: number; attachments: number };

/**
 * Keeps one note and trashes the other. Re-derived on the server from the ids alone: the browser says which two notes and
 * which to keep, never what text to write. Written in an order that loses nothing if it stops part-way (the kept note first,
 * the other trashed last), and running it again finishes it.
 */
export async function mergeNotes(userId: string, input: unknown): Promise<MergeResult> {
  assertUser(userId);
  const parsed = mergeInput.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Choose which note to keep.");
  const { keepId, dropId, keepUpdatedAt, dropUpdatedAt } = parsed.data;
  const { a: keep, b: drop } = await liveNotes(userId, keepId, dropId);
  if (keep.updatedAt.getTime() !== keepUpdatedAt || drop.updatedAt.getTime() !== dropUpdatedAt) {
    throw new AppError("VALIDATION_ERROR", "One of those notes changed since this was shown. Reload the page and look again.");
  }

  const plan = planMerge(keep.content, drop.title, drop.content);
  if (!plan.ok) throw new AppError("VALIDATION_ERROR", TOO_LONG);

  const sameTitle = normalizeTitle(keep.title) === normalizeTitle(drop.title);
  // Text carried over from the other note may link to it by name (or the kept note may already): those links name the kept note now.
  const finalContent = sameTitle ? plan.content : rewriteLinks(plan.content, drop.title, keep.title).content;
  if (finalContent.length > MAX_NOTE_LENGTH) throw new AppError("VALIDATION_ERROR", TOO_LONG);
  const found = await repo.referrersOf(userId, drop.id, drop.title, MAX_REFERRERS);
  // The kept note is written once, above; it is not one of the notes rewritten below from a stale read.
  const referrers = found.filter((note) => note.id !== keep.id);
  if (found.length >= MAX_REFERRERS) {
    throw new AppError("VALIDATION_ERROR", "Too many notes link to the one being merged to move them all at once.");
  }

  // 1. The kept note takes what the other adds, its tags, its place and its star. A version of the old text is kept.
  const tags = [...new Set([...keep.tags, ...drop.tags])].slice(0, MAX_TAGS);
  const changed =
    finalContent !== keep.content ||
    tags.length !== keep.tags.length ||
    (drop.isFavorite && !keep.isFavorite) ||
    (keep.projectId === null && drop.projectId !== null) ||
    (keep.courseId === null && drop.courseId !== null);
  if (changed) {
    await noteService.updateNote(userId, keep.id, {
      title: keep.title,
      content: finalContent,
      tags,
      isFavorite: keep.isFavorite || drop.isFavorite,
      projectId: keep.projectId ?? drop.projectId,
      courseId: keep.courseId ?? drop.courseId,
    });
  }

  // 2. What pointed at the other now points at the kept note.
  const moved = await repo.moveChildren(userId, drop.id, keep.id);

  // 3. A note that wrote [[Other title]] now writes [[Kept title]] (a version of each is kept), unless the two titles are one.
  let linksRewritten = 0;
  if (!sameTitle) {
    for (const referrer of referrers) {
      const rewritten = rewriteLinks(referrer.content, drop.title, keep.title);
      if (rewritten.changed === 0) continue;
      await noteService.updateNote(userId, referrer.id, {
        title: referrer.title,
        content: rewritten.content,
        tags: referrer.tags,
        isFavorite: referrer.isFavorite,
        projectId: referrer.projectId,
        courseId: referrer.courseId,
      });
      linksRewritten += rewritten.changed;
    }
  }

  // 4. The other goes to the trash (it can be restored), then every note that linked to it is read again: with one title for both,
  //    the links now resolve to the kept note.
  await noteService.deleteNote(userId, drop.id);
  if (sameTitle) {
    for (const referrer of referrers) {
      const current = await noteRepository.getNote(userId, referrer.id);
      if (current) await noteService.syncNoteLinks(userId, current);
    }
  }
  return { addedBlocks: plan.added.length, linksRewritten, tasks: moved.tasks, cards: moved.cards, attachments: moved.attachments };
}
