// Duplicate notes (ROADMAP item 36). Pure text rules, no Prisma and no React, so each is tested without a database.
// The vectors only say two notes are about the same thing; whether one is a copy of the other is settled here, from
// the words, so a pair is shown for a reason a person can read and a wrong merge is not made on topic alone.

import { scanFences } from "@/lib/markdown-fences";
import { MAX_NOTE_LENGTH } from "@/lib/see-also";
import { normalizeTitle } from "@/lib/wiki-links";

// Measured, not guessed (28 notes on 6 topics, `nomic-embed-text`, the mean of a note's chunk vectors, 2026-11-15; the
// log is kept beside this work). Cosine of the means: a copy with other spacing and markup 0.929 to 1.000 (n=6), a copy
// with a sentence added 0.969 to 0.988 (n=6), the same facts reworded 0.828 to 0.956 (median 0.895, n=6), a different note
// in the same field 0.635 to 0.837 (n=24), unrelated notes 0.423 to 0.704 (n=375). Text containment of three-word runs:
// copies and edits 1.000, reworded 0 to 0.077, different notes 0 to 0.026. So 0.88 keeps every copy and edit and about
// three in five rewordings and no different note; 0.90 with a text check is what makes a pair a copy. The sample is small,
// synthetic and made of short notes: read the numbers as a picture, not as rates.
/** The least average-vector similarity at which two notes are offered at all. */
export const DUPLICATE_MIN_SIMILARITY = 0.88;
/** Alike enough in meaning AND in words to be called a copy of one another. */
export const COPY_MIN_SIMILARITY = 0.9;
export const COPY_MIN_CONTAINMENT = 0.8;

export type PairKind = "same-text" | "same-ideas";

/** Why a pair is offered, from the vector similarity (null when the notes were found by their text alone) and the words. */
export function classifyPair(similarity: number | null, text: PairText): PairKind | null {
  if (text.same) return "same-text";
  if (similarity === null) return null;
  if (similarity >= COPY_MIN_SIMILARITY && text.containment >= COPY_MIN_CONTAINMENT) return "same-text";
  return similarity >= DUPLICATE_MIN_SIMILARITY ? "same-ideas" : null;
}

/** Words beyond these are not read: a 100,000-character note is about 17,000 words. */
const MAX_WORDS = 25_000;
const SHINGLE = 3;

/** Lower-cased words (letters and digits of any script), nothing else: markup, spacing and case do not make a note different. */
export function words(text: string): string[] {
  const found = text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return found.length > MAX_WORDS ? found.slice(0, MAX_WORDS) : found;
}

/** The text as one run of words, for "is this exactly the same text". */
export const wordsKey = (text: string): string => words(text).join(" ");

/** Runs of three words. A note shorter than that is one run of what it has, so a one-word note still compares. */
export function shingles(list: readonly string[]): Set<string> {
  const out = new Set<string>();
  if (list.length === 0) return out;
  if (list.length < SHINGLE) {
    out.add(list.join(" "));
    return out;
  }
  for (let at = 0; at + SHINGLE <= list.length; at++) out.add(list.slice(at, at + SHINGLE).join(" "));
  return out;
}

/** How much of the smaller note is in the larger, 0 to 1. A short note copied into a long one scores 1, which is the point. */
export function containment(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size === 0) return 0;
  let shared = 0;
  for (const item of small) if (large.has(item)) shared += 1;
  return shared / small.size;
}

/** The shared part of the two over their union, 0 to 1: unlike containment, a note that merely contains another scores low. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of small) if (large.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export type PairText = { same: boolean; containment: number; jaccard: number };

/** What the words of two notes say about the pair. Titles are not part of it: a copy often has a different title. */
export function compareText(a: string, b: string): PairText {
  const wa = words(a);
  const wb = words(b);
  const same = wa.length > 0 && wa.length === wb.length && wa.every((word, index) => word === wb[index]);
  const sa = shingles(wa);
  const sb = shingles(wb);
  return { same, containment: containment(sa, sb), jaccard: jaccard(sa, sb) };
}

/** One key for a pair whichever way round it is named, so a decision about it holds both ways. Ids are uuids; the bar cannot be in one. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
/** The pair in the order it is stored in. */
export function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

// --- merging ---------------------------------------------------------------------------------------------

/** Blocks of a note's text: paragraphs split at blank lines, a fenced code block always one block. */
export function blocks(content: string): string[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const { inFence } = scanFences(lines);
  const out: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) out.push(current.join("\n"));
    current = [];
  };
  lines.forEach((line, index) => {
    if (!inFence[index] && line.trim() === "") flush();
    else current.push(line);
  });
  flush();
  return out;
}

export const MERGE_HEADING_PREFIX = "Merged from";

export type MergePlan =
  | { ok: true; content: string; added: string[] }
  | { ok: false; reason: "too-long" };

/**
 * The kept note's text with whatever the other note says and it does not. A block of the other note counts as already
 * there when its words appear, in order, inside the kept note's words, so a copy that differs in spacing, case or markup
 * adds nothing, and a copy with one extra paragraph adds that paragraph. Nothing is ever removed from the kept note. The
 * added blocks go at the end under `## Merged from <title>`, in the order they had, so they can be moved by hand.
 */
export function planMerge(keepContent: string, otherTitle: string, otherContent: string): MergePlan {
  const have = ` ${wordsKey(keepContent)} `;
  const added = blocks(otherContent).filter((block) => {
    const key = wordsKey(block);
    return key !== "" && !have.includes(` ${key} `);
  });
  if (added.length === 0) return { ok: true, content: keepContent, added };
  const heading = `## ${MERGE_HEADING_PREFIX} ${otherTitle.replace(/[\r\n]+/g, " ").trim()}`;
  const base = keepContent.replace(/\s+$/, "");
  const content = `${base}${base === "" ? "" : "\n\n"}${heading}\n\n${added.join("\n\n")}\n`;
  return content.length > MAX_NOTE_LENGTH ? { ok: false, reason: "too-long" } : { ok: true, content, added };
}

/**
 * `[[from]]` written as `[[to]]` wherever it is a link: not inside a fenced block or an inline code span, which are text
 * about code. Titles compare as links do (case and spacing folded), and the text between the brackets is replaced whole.
 * Returns the new text and how many links changed.
 */
export function rewriteLinks(content: string, from: string, to: string): { content: string; changed: number } {
  const target = normalizeTitle(from);
  if (target === "" || normalizeTitle(to) === target) return { content, changed: 0 };
  const lines = content.split("\n");
  const { inFence } = scanFences(lines.map((line) => line.replace(/\r$/, "")));
  let changed = 0;
  const out = lines.map((line, index) => {
    if (inFence[index]) return line;
    // Even pieces are outside inline code; odd ones are the code spans, kept as written.
    return line
      .split(/(`+[^`\n]*`+)/)
      .map((piece, at) =>
        at % 2 === 1
          ? piece
          : piece.replace(/\[\[([^[\]\n]+)\]\]/g, (whole, inner: string) => {
              if (normalizeTitle(inner) !== target) return whole;
              changed += 1;
              return `[[${to}]]`;
            }),
      )
      .join("");
  });
  return { content: out.join("\n"), changed };
}
