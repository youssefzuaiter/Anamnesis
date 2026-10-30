// Pure text parsing, deliberately free of `server-only` and of any database
// import so it can be tested and reused without a Prisma connection.

const WIKI_LINK = /\[\[([^\[\]\n]+)\]\]/g;

/** The same syntax, for renderers that substitute links into parsed text.
 *  Exported as a factory because a /g regex carries mutable lastIndex state
 *  and must not be shared between callers. */
export function wikiLinkPattern(): RegExp {
  return new RegExp(WIKI_LINK.source, "g");
}
/** The most distinct links a note is read for; links beyond it are never registered. */
export const MAX_LINKS = 50;

/**
 * Extracts `[[Note title]]` references. Titles are compared case-insensitively
 * and with collapsed whitespace, so `[[ My Note ]]` and `[[my note]]` resolve to
 * the same target, while the original spelling is kept for display.
 */
export function parseWikiLinks(content: string): string[] {
  const seen = new Map<string, string>();

  for (const match of content.matchAll(WIKI_LINK)) {
    const raw = match[1].trim();
    if (!raw) continue;

    const key = normalizeTitle(raw);
    if (!seen.has(key)) seen.set(key, raw);
    if (seen.size >= MAX_LINKS) break;
  }

  return [...seen.values()];
}

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}
