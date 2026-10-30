// Whether the note on this page is open in the editor. The editor (inside NoteView) and
// the rail's cards are in different parts of the tree and share no client parent, so the
// flag lives here, read with useSyncExternalStore. It is a UI flag in one tab and carries
// nothing else.

let editing = false;
const listeners = new Set<() => void>();

export function setNoteEditing(next: boolean): void {
  if (editing === next) return;
  editing = next;
  for (const listener of listeners) listener();
}

export function subscribeNoteEditing(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isNoteEditing(): boolean {
  return editing;
}
