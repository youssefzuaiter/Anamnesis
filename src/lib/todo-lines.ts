import { scanFences } from "@/lib/markdown-fences";
import { titleKey } from "@/lib/assistant-edits";

/**
 * The tasks a note is asking for (ROADMAP item 33): unchecked checkboxes (`- [ ] …`) and `TODO: …` lines, read from
 * the note's own text. Pure, so the rules are unit-tested. Fenced code is skipped, a done checkbox is never offered,
 * and a title is offered once per note however often it appears.
 */

export const MAX_TODO_TITLE = 200;

const CHECKBOX = /^\s*[-*+]\s+\[ \]\s*(.*)$/;
const TODO = /^\s*TODO:\s*(.*)$/;

export function todoTitles(content: string): string[] {
  const lines = content.split("\n");
  const { inFence } = scanFences(lines);
  const seen = new Set<string>();
  const titles: string[] = [];
  lines.forEach((line, index) => {
    if (inFence[index]) return;
    const match = CHECKBOX.exec(line) ?? TODO.exec(line);
    if (!match) return;
    const title = match[1].trim().slice(0, MAX_TODO_TITLE).trim();
    if (!title) return;
    const key = titleKey(title);
    if (seen.has(key)) return;
    seen.add(key);
    titles.push(title);
  });
  return titles;
}
