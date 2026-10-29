// Adds a `[[Title]]` link to a note as a bullet under its "See also" heading.
// Pure text, no Prisma and no React, so every shape of note can be unit-tested.

import { normalizeTitle, wikiLinkPattern } from "@/lib/wiki-links";
import { scanFences } from "@/lib/markdown-fences";

export const SEE_ALSO_HEADING = "See also";

/** The editor's own limit on a note's text; the actions' schemas enforce the same number. */
export const MAX_NOTE_LENGTH = 100_000;

const MAX_TITLE_LENGTH = 200;
// `[ \t]*#*[ \t]*` here was quadratic on a line of spaces (6 s for 100,000); an ATX
// closing sequence needs a space before it, which makes each branch linear.
const SEE_ALSO_LINE = /^ {0,3}##[ \t]+see also(?:[ \t]+#+)?[ \t]*$/i;
const ANY_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;

/** A title can be written as `[[...]]` only if it has no brackets or line break. */
export function canLinkTitle(title: string): boolean {
  const trimmed = title.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= MAX_TITLE_LENGTH &&
    !/[\[\]\r\n]/.test(trimmed)
  );
}

/**
 * Whether the text already holds a `[[...]]` that resolves to this title. Like the
 * index, it reads raw text, code blocks included, but it does not stop at the 50
 * links the index follows: a link that is written must never be written twice.
 */
export function linksTo(content: string, title: string): boolean {
  const wanted = normalizeTitle(title);
  for (const match of content.matchAll(wikiLinkPattern())) {
    if (normalizeTitle(match[1]) === wanted) return true;
  }
  return false;
}

/**
 * Appends `- [[Title]]` to the note's "See also" section, creating the section at
 * the end if there is none. Nothing the person wrote is changed, apart from the
 * trailing blank lines being normalised to one newline. `added` is false, and the
 * text untouched, when the note already links to the title.
 */
export function appendSeeAlso(
  content: string,
  title: string,
): { content: string; added: boolean } {
  if (!canLinkTitle(title)) {
    throw new Error("That title cannot be written as a link.");
  }
  if (linksTo(content, title)) return { content, added: false };

  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);

  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

  // A fence left open would swallow the new section, so it is closed first.
  const { open } = scanFences(lines);
  if (open !== null) lines.push(open);

  const bullet = `- [[${title.trim()}]]`;
  const { inFence } = scanFences(lines);
  const heading = lines.findIndex(
    (line, index) => !inFence[index] && SEE_ALSO_LINE.test(line),
  );

  if (heading === -1) {
    if (lines.length > 0) lines.push("");
    lines.push(`## ${SEE_ALSO_HEADING}`, "", bullet);
  } else {
    let end = lines.length;
    for (let index = heading + 1; index < lines.length; index++) {
      if (!inFence[index] && ANY_HEADING.test(lines[index])) {
        end = index;
        break;
      }
    }
    let last = heading;
    for (let index = end - 1; index > heading; index--) {
      if (lines[index].trim() !== "") {
        last = index;
        break;
      }
    }
    lines.splice(last + 1, 0, ...(last === heading ? ["", bullet] : [bullet]));
  }

  return { content: lines.join(eol) + eol, added: true };
}
