"use client";

import { useRef, useState } from "react";
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

const smallButton =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-border-subtle px-3 text-xs font-medium text-text transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-8";

/** A quiet button on an item's row, named for the item it acts on so a screen reader hears which one. */
function RowButton({ label, name, disabled, onClick }: { label: string; name: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-label={name} className={smallButton}>
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
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const addField = useRef<HTMLInputElement>(null);

  const progress = checklistProgress(items);
  const full = items.length >= MAX_CHECKLIST_ITEMS;

  /** One change at a time: a second click while one is running does nothing, so a double click acts once. */
  async function run(work: () => Promise<ApiResponse<null>>, after?: () => void) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    try {
      const result = await work();
      if (!result.success) {
        setError(result.error.message);
        return;
      }
      setError(null);
      after?.();
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }

  const add = () =>
    run(
      () => addChecklistItemAction(taskId, draft),
      () => {
        setDraft("");
        addField.current?.focus();
      },
    );

  const saveEdit = () => editing && run(() => renameChecklistItemAction(editing.id, editing.text), () => setEditing(null));

  return (
    <section aria-labelledby="checklist-heading" className="rounded-xl border border-border-subtle bg-surface p-4">
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
                  disabled={busy}
                  onClick={() => run(() => toggleChecklistItemAction(item.id, !item.done))}
                  aria-label={item.done ? `Mark "${item.title}" not done` : `Mark "${item.title}" done`}
                  aria-pressed={item.done}
                  className={`relative mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border-[1.5px] transition-colors after:absolute after:-inset-3 after:content-[''] ${
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
                      onKeyDown={(event) => event.key === "Escape" && setEditing(null)}
                      className="min-h-11 min-w-0 flex-1 rounded-lg border border-control bg-surface px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
                    />
                    <button type="submit" disabled={busy} className={smallButton}>
                      Save
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className={smallButton}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <span className={`min-w-0 flex-1 break-words text-sm ${item.done ? "text-text-faint line-through" : "text-text"}`}>{item.title}</span>
                )}
              </div>

              {editing?.id !== item.id && (
                <div className="flex flex-wrap gap-1.5 pl-8">
                  <RowButton label="Edit" name={`Edit "${item.title}"`} disabled={busy} onClick={() => setEditing({ id: item.id, text: item.title })} />
                  <RowButton label="Up" name={`Move "${item.title}" up`} disabled={busy || index === 0} onClick={() => run(() => moveChecklistItemAction(item.id, "up"))} />
                  <RowButton
                    label="Down"
                    name={`Move "${item.title}" down`}
                    disabled={busy || index === items.length - 1}
                    onClick={() => run(() => moveChecklistItemAction(item.id, "down"))}
                  />
                  <RowButton label="Remove" name={`Remove "${item.title}"`} disabled={busy} onClick={() => run(() => removeChecklistItemAction(item.id))} />
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
          disabled={busy || full || draft.trim() === ""}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
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
