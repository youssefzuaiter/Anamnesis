// The rules of a task's checklist: what a step's title may be, how progress reads, and how steps are
// reordered. Pure: no Prisma, no React. A step is not a task (see "Task checklists" in CLAUDE.md):
// nothing here, and nothing that uses it, feeds a project's or a goal's progress.

export const MAX_CHECKLIST_ITEMS = 50;
export const MAX_ITEM_TITLE = 200;

/**
 * A step's title as it is stored: every control character and line break (and U+2028, U+2029) becomes a
 * space, runs of whitespace collapse to one, the ends are trimmed, a lone surrogate is replaced, and it is
 * cut at 200 UTF-16 units (what the action's length check counts) without splitting a pair. Markup is kept as
 * typed: it is only ever shown as text. One linear pass that stops at the limit.
 */
export function cleanItemTitle(raw: string): string {
  const out: string[] = [];
  let size = 0;
  let gap = false;
  for (const ch of raw) {
    const code = ch.codePointAt(0) as number;
    let c = ch;
    if (code >= 0xd800 && code <= 0xdfff) c = "\ufffd";
    else if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f) || code === 0x2028 || code === 0x2029) c = " ";

    if (/\s/u.test(c)) {
      gap = size > 0;
      continue;
    }
    const width = (gap ? 1 : 0) + c.length;
    if (size + width > MAX_ITEM_TITLE) break;
    if (gap) out.push(" ");
    out.push(c);
    size += width;
    gap = false;
  }
  return out.join("");
}

export type ChecklistCount = { done: number; total: number };
export type ChecklistProgress = ChecklistCount & { complete: boolean };

/** `complete` only when there is something to do and all of it is done: an empty list is not a finished one. */
export function checklistProgress(items: readonly { done: boolean }[]): ChecklistProgress {
  const done = items.filter((item) => item.done).length;
  return { done, total: items.length, complete: items.length > 0 && done === items.length };
}

export type Positioned = { id: string; position: number };

/** Where a new step goes: after every other. */
export function nextPosition(items: readonly { position: number }[]): number {
  return items.reduce((largest, item) => Math.max(largest, item.position + 1), 0);
}

/**
 * Moves a step one place up or down. Steps are ordered by (position, id), so positions that share a value or
 * leave gaps (a delete, two adds at the same instant) still have one order; the result is the rows whose
 * position must be written so that positions become 0..n-1 in the new order: only those that differ from what
 * is stored. Null for an unknown step and for one that is already first (up) or last (down).
 */
export function moveItem(items: readonly Positioned[], id: string, direction: "up" | "down"): Positioned[] | null {
  const ordered = [...items].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const from = ordered.findIndex((item) => item.id === id);
  if (from === -1) return null;
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= ordered.length) return null;
  [ordered[from], ordered[to]] = [ordered[to], ordered[from]];

  const changes: Positioned[] = [];
  ordered.forEach((item, index) => {
    if (item.position !== index) changes.push({ id: item.id, position: index });
  });
  return changes;
}
