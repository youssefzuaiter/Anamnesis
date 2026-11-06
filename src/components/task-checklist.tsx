"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addChecklistItemAction,
  moveChecklistItemAction,
  removeChecklistItemAction,
  renameChecklistItemAction,
  toggleChecklistItemAction,
} from "@/actions/task-checklist";
import type { ApiResponse } from "@/lib/api-response";
import { MAX_CHECKLIST_ITEMS, MAX_ITEM_TITLE, checklistProgress } from "@/lib/checklist";
import { Icon } from "@/components/icons";

type Item = { id: string; title: string; done: boolean };

// "Unavailable" is aria-disabled, not `disabled`: a focused button that becomes disabled loses the keyboard's
// place, and a button is unavailable for the length of every change. Clicks are ignored in the handlers.
const smallButton =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-border-subtle px-3 text-xs font-medium text-text transition-colors hover:bg-surface-subtle aria-disabled:cursor-not-allowed aria-disabled:opacity-40 sm:min-h-8";

/** A quiet button on an item's row, named for the item it acts on so a screen reader hears which one. */
function RowButton({ label, name, unavailable, focusKey, onClick }: { label: string; name: string; unavailable: boolean; focusKey: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-disabled={unavailable || undefined}
      aria-label={name}
      data-focus-key={focusKey}
      onClick={() => {
        if (!unavailable) onClick();
      }}
      className={smallButton}
    >
      {label}
    </button>
  );
}

/**
 * A task's checklist: tick, rename, reorder (Up and Down, so it works on a phone, with a keyboard and with a
 * screen reader) and remove steps. A step is not a task: ticking every one does not finish the task, and
 * nothing here changes a project's or a goal's progress.
 */
export function TaskChecklist({ taskId, items, taskDone }: { taskId: string; items: Item[]; taskDone: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const guard = useRef(false);
  const addField = useRef<HTMLInputElement>(null);
  const section = useRef<HTMLElement>(null);
  const refocus = useRef<string | null>(null);

  const progress = checklistProgress(items);
  const full = items.length >= MAX_CHECKLIST_ITEMS;
  // Unavailable from the click until the refreshed list has arrived, so nothing acts on a row that is gone.
  const busy = working || refreshing;

  // Where the keyboard should be once the list or the editor has changed: a row that moved or closed its editor
  // is a different element, and focus would otherwise fall back to the top of the page.
  useEffect(() => {
    const key = refocus.current;
    if (!key) return;
    refocus.current = null;
    section.current?.querySelector<HTMLElement>(`[data-focus-key="${key}"]`)?.focus();
  }, [items, editing]);

  /** One change at a time: a second click while one is running does nothing, so a double click acts once. */
  async function run(work: () => Promise<ApiResponse<null>>, after?: () => void) {
    if (guard.current || refreshing) return;
    guard.current = true;
    setWorking(true);
    try {
      const result = await work();
      if (result.success) {
        setError(null);
        after?.();
      } else {
        setError(result.error.message);
      }
      // After a success, and when the step is gone (removed in another tab): the list on screen is out of date.
      // Not after a refusal of the input ("write what needs doing"): nothing changed, and a refresh would make
      // the next Enter wait.
      if (result.success || result.error.code === "RESOURCE_NOT_FOUND") startRefresh(() => router.refresh());
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      guard.current = false;
      setWorking(false);
    }
  }

  const closeEditor = (id: string) => {
    refocus.current = `edit:${id}`;
    setEditing(null);
  };

  const add = () =>
    run(
      () => addChecklistItemAction(taskId, draft),
      () => {
        // Only what was sent is cleared: anything typed while it was being saved stays for the next add.
        setDraft((current) => (current === draft ? "" : current));
        addField.current?.focus();
      },
    );

  const remove = (id: string, index: number) =>
    run(
      () => removeChecklistItemAction(id),
      () => {
        const next = items[index + 1] ?? items[index - 1];
        refocus.current = next ? `edit:${next.id}` : "add";
      },
    );

  const move = (id: string, direction: "up" | "down") =>
    run(
      () => moveChecklistItemAction(id, direction),
      () => {
        refocus.current = `${direction}:${id}`;
      },
    );

  const saveEdit = () => editing && run(() => renameChecklistItemAction(editing.id, editing.text), () => closeEditor(editing.id));

  return (
    <section ref={section} aria-labelledby="checklist-heading" className="rounded-xl border border-border-subtle bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id="checklist-heading" className="text-sm font-semibold text-text">
          Checklist
        </h2>
        <p role="status" className="text-xs tabular-nums text-text-muted">
          {progress.done} of {progress.total} done
        </p>
      </div>

      {progress.complete && !taskDone && (
        <p className="mb-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">Every item is done. Mark the task complete above.</p>
      )}

      {items.length > 0 && (
        <ul className="mb-3 flex flex-col">
          {items.map((item, index) => (
            <li key={item.id} className="flex flex-col gap-1.5 border-t border-border-subtle py-2.5 first:border-t-0">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  aria-disabled={busy || undefined}
                  onClick={() => run(() => toggleChecklistItemAction(item.id, !item.done))}
                  aria-label={item.done ? `Mark "${item.title}" not done` : `Mark "${item.title}" done`}
                  className={`relative mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border-[1.5px] transition-colors after:absolute after:-inset-[13.5px] after:content-[''] ${
                    item.done ? "border-accent bg-accent text-on-accent" : "border-control bg-surface hover:border-accent"
                  }`}
                >
                  {item.done && <Icon name="check" className="size-3.5" strokeWidth={2.5} />}
                </button>

                {editing?.id === item.id ? (
                  <form
                    className="flex min-w-0 flex-1 flex-wrap gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveEdit();
                    }}
                  >
                    <input
                      autoFocus
                      value={editing.text}
                      maxLength={MAX_ITEM_TITLE}
                      aria-label="Edit item"
                      onChange={(event) => setEditing({ id: item.id, text: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") closeEditor(item.id);
                      }}
                      className="min-h-11 min-w-0 flex-1 rounded-lg border border-control bg-surface px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
                    />
                    <button type="submit" aria-disabled={busy || undefined} className={smallButton}>
                      Save
                    </button>
                    <button type="button" onClick={() => closeEditor(item.id)} className={smallButton}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <span className={`min-w-0 flex-1 break-words text-sm ${item.done ? "text-text-faint line-through" : "text-text"}`}>{item.title}</span>
                )}
              </div>

              {editing?.id !== item.id && (
                <div className="flex flex-wrap gap-1.5 pl-8">
                  <RowButton label="Edit" name={`Edit "${item.title}"`} unavailable={busy} focusKey={`edit:${item.id}`} onClick={() => setEditing({ id: item.id, text: item.title })} />
                  <RowButton label="Up" name={`Move "${item.title}" up`} unavailable={busy || index === 0} focusKey={`up:${item.id}`} onClick={() => move(item.id, "up")} />
                  <RowButton
                    label="Down"
                    name={`Move "${item.title}" down`}
                    unavailable={busy || index === items.length - 1}
                    focusKey={`down:${item.id}`}
                    onClick={() => move(item.id, "down")}
                  />
                  <RowButton label="Remove" name={`Remove "${item.title}"`} unavailable={busy} focusKey={`remove:${item.id}`} onClick={() => remove(item.id, index)} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <input
          ref={addField}
          data-focus-key="add"
          value={draft}
          maxLength={MAX_ITEM_TITLE}
          disabled={full}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="Add an item"
          placeholder="Add an item"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-control bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={full || draft.trim() === ""}
          aria-disabled={busy || undefined}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        >
          Add item
        </button>
      </form>
      {full && <p className="mt-2 text-xs text-text-muted">A checklist holds at most {MAX_CHECKLIST_ITEMS} items.</p>}

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
