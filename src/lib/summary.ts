// Summarising a note (ROADMAP 24): the parts that are not the model. Pure.
//
// A 3B model with Ollama's default context cannot read a long note in one go, and text past the
// context is dropped silently, so a note is read in sections, each section's points are checked
// against that section, and the overview is written from the kept points only.

import { groundedness } from "@/lib/quiz";
import { dateLabel } from "@/lib/note-templates";

/** The most text the model reads in one call (about 1,500 tokens, well inside an 8,192 context). */
export const SECTION_CHARS = 6_000;
/** A 100,000-character note in sections of at least half the window: at most 34. */
export const MAX_SECTIONS = 34;
/** Measured in the evals; a point whose words mostly are not in its section is dropped. */
export const GROUNDED_FLOOR = 0.5;

/**
 * The note in sections of at most SECTION_CHARS: cut at the last blank line in the window, else the
 * last line break, else hard, and never before half the window, so sections stay large and few.
 */
export function sections(text: string): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < text.length && out.length < MAX_SECTIONS) {
    let end = Math.min(text.length, at + SECTION_CHARS);
    if (end < text.length) {
      const window = text.slice(at, end);
      const half = SECTION_CHARS / 2;
      const paragraph = window.lastIndexOf("\n\n");
      const line = window.lastIndexOf("\n");
      if (paragraph >= half) end = at + paragraph;
      else if (line >= half) end = at + line;
    }
    const part = text.slice(at, end).trim();
    if (part) out.push(part);
    at = end;
  }
  return out;
}

/** The points whose words come from `section`, and the ones that do not. */
export function keepGrounded(points: string[], section: string, floor: number): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const point of points) (groundedness(point, section) >= floor ? kept : dropped).push(point);
  return { kept, dropped };
}

/** A title that can sit inside `[[...]]` and still resolve: no brackets, no line break. */
const linkable = (title: string) => !/[[\]\n]/.test(title) && title.trim() === title && title.length > 0;

/** The new note: it says where it came from, that the assistant wrote it, and when. */
export function summaryNote(sourceTitle: string, overview: string, points: string[], now: Date): { title: string; content: string } {
  const source = linkable(sourceTitle) ? `[[${sourceTitle}]]` : `"${sourceTitle}"`;
  const content = [
    `> Summary of ${source} by the assistant on ${dateLabel(now)}. Check it against the note before relying on it.`,
    "## Overview",
    overview.trim(),
    "## Key points",
    points.map((point) => `- ${point.trim()}`).join("\n"),
  ].join("\n\n");
  return { title: `Summary: ${sourceTitle}`.slice(0, 200), content };
}
