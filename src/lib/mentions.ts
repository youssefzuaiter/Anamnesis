// Finds a note's title written out as plain words in another note's text.
// Pure text, no Prisma and no React.

import { scanFences } from "@/lib/markdown-fences";

/** Shorter titles ("ML", "Maths") would match ordinary words all over a workspace. */
export const MIN_MENTION_TITLE_LENGTH = 5;

const SNIPPET_LENGTH = 90;
const MASK = "\u0000";

// Places a title is not "mentioned": code, an existing link, an address.
//
// The two link patterns have bounded quantifiers on purpose. Unbounded, a run of `[`
// with no `]` after it makes every `[` scan to the end of its line, which is quadratic:
// 100,000 characters took six seconds and stalled the whole server. Bounded, each
// start costs at most a few hundred steps. A link longer than the bound is not
// recognised as one, so a mention inside it counts, which is the safe direction.
const MASKED_SPANS = [
  /(`+)(.+?)\1/g, // inline code
  /\[\[[^\[\]\n]{0,200}\]\]/g, // a wiki link, whether or not it points at this title
  /!?\[[^\]\n]{0,200}\]\([^)\n]{0,500}\)/g, // a Markdown link or image, text and address
  /<?https?:\/\/[^\s>]+>?/g, // a bare address
];

const LEADING_MARKER = /^(?: {0,3}(?:#{1,6}[ \t]+|>[ \t]?|(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?))+/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Same length as the text, so a position found in the masked copy is a position in
// the original. The mask is not a space, so words either side of a hidden span
// cannot join into a match.
function maskExcluded(content: string): string {
  const lines = content.split("\n");
  const { inFence } = scanFences(lines);
  let masked = lines
    .map((line, index) => (inFence[index] ? MASK.repeat(line.length) : line))
    .join("\n");

  for (const span of MASKED_SPANS) {
    masked = masked.replace(span, (found) => MASK.repeat(found.length));
  }
  return masked;
}

/**
 * About 90 characters of the line around the match, with list, heading and quote
 * markers dropped and backticks removed. Null unless `title` appears as whole words,
 * in any case, outside code, links and addresses. A title is matched within a line:
 * one that a hard line break splits is not found.
 */
export function mentionSnippet(content: string, title: string): string | null {
  const words = title.trim().split(/\s+/);
  const text = words.join(" ");
  if (text.length < MIN_MENTION_TITLE_LENGTH) return null;

  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])${words.map(escapeRegExp).join("[^\\S\\n]+")}(?![\\p{L}\\p{N}_])`,
    "iu",
  );
  const found = pattern.exec(maskExcluded(content));
  if (!found) return null;

  const lineStart = content.lastIndexOf("\n", found.index - 1) + 1;
  const lineEndAt = content.indexOf("\n", found.index);
  const line = content
    .slice(lineStart, lineEndAt === -1 ? content.length : lineEndAt)
    .replace(/\r$/, "");

  let from = 0;
  const marker = LEADING_MARKER.exec(line);
  if (marker && marker[0].length <= found.index - lineStart) from = marker[0].length;

  const body = line.slice(from);
  const at = found.index - lineStart - from;
  const width = Math.max(SNIPPET_LENGTH, found[0].length);

  let start = 0;
  let end = body.length;
  if (body.length > width) {
    start = Math.min(
      Math.max(0, at - Math.floor((width - found[0].length) / 2)),
      body.length - width,
    );
    end = start + width;
  }

  const snippet = `${start > 0 ? "…" : ""}${body.slice(start, end)}${end < body.length ? "…" : ""}`;
  return snippet.replace(/`/g, "").replace(/\s+/g, " ").trim();
}
