// Citations in a note's text, in pandoc's syntax. Pure.
//
//   [@key]  [@key, p. 3]  [@a; @b]  [see @a, chap. 2]  [-@a] (year only)
//   @key    a narrative citation, only when the key is one of the account's references
//
// Bracketed citations need no reference to exist (an unknown key is shown as unresolved, so a typo
// is visible); a bare @key does, so "@someone" in a note is left alone. Everything is bounded: a
// bracket is read at most MAX_BRACKET characters, a key at most 100, so a long hostile text is one pass.

import { scanFences } from "@/lib/markdown-fences";

export type CiteItem = { key: string; prefix: string; locator: string; suppressAuthor: boolean };
export type Citation = { start: number; end: number; items: CiteItem[]; narrative: boolean };

const MAX_BRACKET = 1_000;
const MAX_KEYS = 500;
// A key starts and ends with a letter, digit or underscore and may hold pandoc's punctuation inside,
// so "[@a]." and "@a." end the key at "a".
const KEY = String.raw`[A-Za-z0-9_](?:[A-Za-z0-9_:.#$%&+?<>~/-]{0,98}[A-Za-z0-9_])?`;
const ITEM = new RegExp(String.raw`^([\s\S]*?)(-?)@(${KEY})(.*)$`, "s");
const BARE = new RegExp(String.raw`(^|[^A-Za-z0-9_@.])@(${KEY})`, "g");

/** One item of a bracket, or null when the item is not a citation. */
function parseItem(raw: string): CiteItem | null {
  const match = ITEM.exec(raw.trim());
  if (!match) return null;
  const [, prefix, minus, key, rest] = match;
  // "email@x.com" is not a citation: the @ must not follow a letter or digit.
  if (/[A-Za-z0-9_.]$/.test(prefix) || /@/.test(prefix)) return null;
  if (rest && !/^\s*,/.test(rest)) return null;
  return { key, prefix: prefix.trim(), locator: rest.replace(/^\s*,\s*/, "").trim(), suppressAuthor: minus === "-" };
}

/** Every citation in `text`, in order. `known` says whether a bare @key names a reference. */
export function findCitations(text: string, known: (key: string) => boolean): Citation[] {
  const found: Citation[] = [];
  for (let open = text.indexOf("["); open !== -1; open = text.indexOf("[", open + 1)) {
    // The bracket's content: up to the next ] with no [ before it, within the bound.
    let close = -1;
    const limit = Math.min(text.length, open + 1 + MAX_BRACKET);
    for (let i = open + 1; i < limit; i++) {
      if (text[i] === "]") {
        close = i;
        break;
      }
      if (text[i] === "[" || text[i] === "\n") break;
    }
    if (close === -1) continue;
    const content = text.slice(open + 1, close);
    if (!content.includes("@")) continue;
    const items = content.split(";").map(parseItem);
    if (items.every((item): item is CiteItem => item !== null)) {
      found.push({ start: open, end: close + 1, items, narrative: false });
      open = close;
    }
  }

  // Brackets were found in order and do not overlap, and bare matches come in order too, so one
  // pointer walks through the brackets: linear, where checking every bracket per match was not
  // (25,000 brackets took 367 ms).
  let bracket = 0;
  const covered = (at: number) => {
    while (bracket < found.length && found[bracket].end <= at) bracket++;
    return bracket < found.length && found[bracket].start <= at;
  };
  const narrative: Citation[] = [];
  BARE.lastIndex = 0;
  for (let match = BARE.exec(text); match; match = BARE.exec(text)) {
    const at = match.index + match[1].length;
    const key = match[2];
    if (!covered(at) && known(key)) {
      narrative.push({ start: at, end: at + 1 + key.length, items: [{ key, prefix: "", locator: "", suppressAuthor: false }], narrative: true });
    }
  }
  return [...found, ...narrative].sort((a, b) => a.start - b.start);
}

/**
 * The keys a note cites, outside fenced code and inline code, in order of first appearance, at most
 * 500. Bare @words count too: whether they are references is the database's answer, not this one's.
 */
export function citedKeys(markdown: string): string[] {
  const lines = markdown.split("\n");
  const { inFence } = scanFences(lines);
  const prose = lines
    .map((line, index) => (inFence[index] ? "" : line.replace(/`[^`\n]*`/g, " ")))
    .join("\n");
  const keys = new Set<string>();
  for (const citation of findCitations(prose, () => true)) {
    for (const item of citation.items) {
      keys.add(item.key);
      if (keys.size >= MAX_KEYS) return [...keys];
    }
  }
  return [...keys];
}
