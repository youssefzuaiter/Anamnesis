"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { moveTaskAction } from "@/actions/tasks";
import { Icon, type IconName } from "@/components/icons";
import { PRIORITY_STYLES } from "@/components/priority-style";
import { BOARD_COLUMNS, DONE_SHOWN, columnsOf, moveCard, otherColumns, type BoardCard } from "@/lib/board";
import { BOARD_DRAG_MIME, type TaskStatus } from "@/lib/domain";

const STATUS_ICON: Record<TaskStatus, IconName> = { todo: "statusTodo", in_progress: "statusDoing", done: "statusDone" };

const EMPTY: Record<TaskStatus, string> = {
  todo: "Nothing waiting. New tasks land here.",
  in_progress: "Nothing in progress. Drag a task here, or use the buttons on a card.",
  done: "Nothing done yet.",
};

// "Unavailable" is aria-disabled, not `disabled`: a focused button that becomes disabled loses the keyboard's place,
// and every control is unavailable for the length of a move. Clicks are ignored in the handlers.
const chip =
  "inline-flex min-h-11 items-center gap-1 rounded-lg border border-border-subtle px-3 text-xs font-medium text-text transition-colors hover:bg-surface-subtle aria-disabled:cursor-not-allowed aria-disabled:opacity-40 lg:min-h-8";

/** One card: the checkbox, the title, its facts, and the buttons that move it to the other two columns. */
function CardItem({
  card,
  pending,
  dragging,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  card: BoardCard;
  pending: boolean;
  dragging: boolean;
  onMove: (card: BoardCard, to: TaskStatus) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  const done = card.status === "done";
  const late = card.pastDue && !done;
  return (
    <li
      draggable={!pending}
      onDragStart={(event) => {
        event.dataTransfer.setData(BOARD_DRAG_MIME, card.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart(card.id);
      }}
      onDragEnd={onDragEnd}
      className={`cursor-grab rounded-xl border border-border-subtle bg-surface px-4 py-3 ${dragging ? "opacity-50" : ""}`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          aria-disabled={pending || undefined}
          aria-label={done ? `Reopen ${card.title}` : `Complete ${card.title}`}
          onClick={() => onMove(card, done ? "todo" : "done")}
          className={`relative mt-px flex size-5 shrink-0 items-center justify-center rounded-md border-[1.5px] transition-colors after:absolute after:-inset-[13.5px] after:content-[''] aria-disabled:cursor-not-allowed aria-disabled:opacity-40 ${
            done ? "border-accent bg-accent text-on-accent" : "border-control bg-surface hover:border-accent"
          }`}
        >
          {done && <Icon name="check" className="size-3.5" strokeWidth={2.5} />}
        </button>
        <div className="min-w-0 flex-1">
          <Link
            href={`/tasks/${card.id}`}
            data-focus-key={`card:${card.id}`}
            className={`block break-words text-sm font-semibold leading-5 transition-colors hover:text-accent ${
              done ? "text-text-faint line-through" : "text-text"
            }`}
          >
            {card.recurring && "↻ "}
            {card.title}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs leading-4">
            {card.dueLabel && (
              <span className={late ? "font-semibold text-warn" : "text-text-faint"}>
                {late ? "Overdue · " : ""}
                {card.dueLabel}
              </span>
            )}
            <span className={PRIORITY_STYLES[card.priority]}>{card.priority}</span>
            <span className="tabular-nums text-text-faint">{card.estimatedMinutes}m</span>
            {card.checklist && (
              <span className="tabular-nums text-text-muted">
                <span aria-hidden="true">
                  {card.checklist.done}/{card.checklist.total}
                </span>
                <span className="sr-only">
                  {card.checklist.done} of {card.checklist.total} checklist items done
                </span>
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2 pl-8">
        {otherColumns(card.status).map((to) => (
          <button
            key={to.status}
            type="button"
            aria-disabled={pending || undefined}
            aria-label={`Move "${card.title}" to ${to.label}`}
            onClick={() => onMove(card, to.status)}
            className={chip}
          >
            <Icon name="chevronRight" className="size-3" strokeWidth={2} />
            {to.label}
          </button>
        ))}
      </div>
    </li>
  );
}

/**
 * A project's tasks as three columns by status. A card moves by drag (desktop) or by the buttons on it (keyboard,
 * touch), at once on screen and then for real: the move is the same `setTaskStatus` the checkbox uses. Below `lg`
 * one column shows at a time, chosen with the buttons above them; the three are always in the page.
 */
export function TaskBoard({ cards }: { cards: BoardCard[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimistic, applyMove] = useOptimistic(cards, (state, move: { id: string; to: TaskStatus; at: number }) =>
    moveCard(state, move.id, move.to, move.at),
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [shown, setShown] = useState<TaskStatus>("todo");
  const [showAllDone, setShowAllDone] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const root = useRef<HTMLElement>(null);
  const busy = useRef(false);
  const refocus = useRef<string | null>(null);

  const columns = columnsOf(optimistic);
  const dragged = dragging ? optimistic.find((card) => card.id === dragging) : undefined;

  // A card that changes column is a different element, so focus would fall back to the top of the page: put it
  // back on the card's title once the list has changed (and again if the move is taken back). Below lg the card may
  // have gone to a column that is not showing, which cannot take focus: then it stays with the buttons that say which
  // column is.
  useEffect(() => {
    const id = refocus.current;
    if (!id || !root.current) return;
    refocus.current = null;
    const title = root.current.querySelector<HTMLElement>(`[data-focus-key="card:${id}"]`);
    const showing = title && title.getClientRects().length > 0 ? title : root.current.querySelector<HTMLElement>('[aria-pressed="true"]');
    showing?.focus();
  }, [optimistic]);

  function move(card: BoardCard, to: TaskStatus) {
    if (busy.current || pending || card.status === to) return;
    busy.current = true;
    refocus.current = card.id;
    setError(null);
    setNotice("");
    const label = BOARD_COLUMNS.find((column) => column.status === to)?.label ?? to;
    startTransition(async () => {
      applyMove({ id: card.id, to, at: Date.now() });
      try {
        const result = await moveTaskAction(card.id, to);
        if (result.success) {
          setNotice(`Moved “${card.title}” to ${label}.`);
        } else {
          setError(result.error.message);
          refocus.current = card.id;
          // The task is gone (removed in another tab): the list on screen is what is out of date.
          if (result.error.code === "RESOURCE_NOT_FOUND") router.refresh();
        }
      } catch {
        setError("Could not reach the server. Try again.");
        refocus.current = card.id;
      } finally {
        busy.current = false;
      }
    });
  }

  return (
    <section ref={root} aria-label="Board" className="flex flex-col gap-3">
      <p role="status" className="sr-only">
        {notice}
      </p>
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div role="group" aria-label="Show column" className="grid grid-cols-3 gap-1 rounded-xl bg-surface-subtle p-1 lg:hidden">
        {columns.map((column) => (
          <button
            key={column.status}
            type="button"
            aria-pressed={shown === column.status}
            onClick={() => setShown(column.status)}
            className={`flex min-h-11 items-center justify-center gap-1.5 rounded-[9px] border px-1 text-[13px] font-semibold transition-colors ${
              shown === column.status ? "border-border-subtle bg-surface text-accent-ink" : "border-transparent text-text-muted"
            }`}
          >
            <span>{column.label}</span>
            <span className="font-medium tabular-nums">{column.cards.length}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        {columns.map((column) => {
          const capped = column.status === "done" && !showAllDone && column.cards.length > DONE_SHOWN;
          const visible = capped ? column.cards.slice(0, DONE_SHOWN) : column.cards;
          return (
            <section
              key={column.status}
              aria-label={column.label}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(BOARD_DRAG_MIME)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDragEnter={(event) => {
                if (!event.dataTransfer.types.includes(BOARD_DRAG_MIME)) return;
                if (dragged && dragged.status !== column.status) setOver(column.status);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                // The drag is over here: the browser does not send dragend to a card that is removed by the move.
                setOver(null);
                setDragging(null);
                const id = event.dataTransfer.getData(BOARD_DRAG_MIME);
                const card = optimistic.find((c) => c.id === id);
                if (card) move(card, column.status);
              }}
              className={`min-w-0 flex-col gap-2.5 rounded-2xl p-3 transition-colors ${shown === column.status ? "flex" : "hidden"} lg:flex ${
                over === column.status ? "bg-accent-soft outline-2 -outline-offset-2 outline-accent outline-dashed" : "bg-surface-subtle"
              }`}
            >
              {/* Below lg the buttons above the columns already say which column and how many. */}
              <header className="flex items-center gap-2 px-1 pt-0.5 max-lg:hidden">
                <Icon name={STATUS_ICON[column.status]} className={`size-4 ${column.status === "done" ? "text-accent" : "text-text-faint"}`} />
                <h2 className="text-xs font-semibold text-text-muted">{column.label}</h2>
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-border-subtle bg-surface px-1.5 text-xs font-semibold tabular-nums text-text-muted">
                  {column.cards.length}
                  <span className="sr-only"> {column.cards.length === 1 ? "task" : "tasks"}</span>
                </span>
              </header>

              {column.cards.length === 0 && (
                <p className="rounded-xl border border-dashed border-border-strong px-3 py-5 text-center text-[13px] leading-5 text-text-muted">
                  {EMPTY[column.status]}
                </p>
              )}

              <ul className="flex flex-col gap-2">
                {visible.map((card) => (
                  <CardItem
                    key={card.id}
                    card={card}
                    pending={pending}
                    dragging={dragging === card.id}
                    onMove={move}
                    onDragStart={setDragging}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                  />
                ))}
              </ul>

              {column.status === "done" && column.cards.length > DONE_SHOWN && (
                <button type="button" aria-expanded={showAllDone} onClick={() => setShowAllDone((value) => !value)} className={`${chip} self-start`}>
                  {showAllDone ? "Show fewer" : `Show all ${column.cards.length}`}
                </button>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
