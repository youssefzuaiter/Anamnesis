"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { moveEventAction } from "@/actions/events";
import { moveTaskBlockAction, scheduleTaskAtAction } from "@/actions/tasks";
import { Icon } from "@/components/icons";
import type { ApiResponse } from "@/lib/api-response";
import { dayBounds } from "@/lib/day";
import { TASK_DRAG_MIME } from "@/lib/domain";
import {
  HOUR_PX,
  OPEN_AT_MINUTES,
  applyRange,
  dropRange,
  estimateFromDragTypes,
  findItem,
  formatRange,
  layoutDay,
  minutesAtY,
  minutesIn,
  moveRange,
  nudge,
  resizeRange,
  topPx,
  type GridDay,
  type GridItem,
  type NudgeOp,
  type Range,
  type StripItem,
} from "@/lib/time-grid";

const HOURS = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);
const GAP_PX = 2;
const MIN_HEIGHT_PX = 20;
const DEFAULT_ESTIMATE_MINUTES = 60;

const dayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const headFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric" });

function parts(format: Intl.DateTimeFormat, ms: number): Record<string, string> {
  return Object.fromEntries(format.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
}
/** "Wed 11 Nov": how the grid names a day, built from the parts so the order does not depend on the locale's punctuation. */
function dayLabel(ms: number): string {
  const p = parts(dayFormat, ms);
  return `${p.weekday} ${p.day} ${p.month}`;
}
function headLabel(ms: number): string {
  const p = parts(headFormat, ms);
  return `${p.weekday} ${p.day}`;
}

const kindWord = (item: GridItem) => (item.locked ? "imported, read-only" : item.kind === "event" ? "event" : "time block");
const editHref = (item: GridItem) => (item.kind === "event" ? `/calendar/${item.id}` : `/tasks/${item.id}`);
const rangeOf = (item: GridItem): Range => ({ start: item.start, end: item.end });
const holds = (day: GridDay, at: number) => at >= day.date && at < dayBounds(new Date(day.date)).to.getTime();

type Move = { key: string; range: Range };
type Preview = { date: number; range: Range };
/** What is drawn while a block is dragged: the range it would take if let go now. */
type Draft = { key: string; title: string; range: Range };
/** A mouse or pen press on a block: it becomes a drag only after it has moved this far, so a click stays a click. */
type Gesture = {
  item: GridItem;
  mode: "move" | "start" | "end";
  pointerId: number;
  x: number;
  y: number;
  scrollTop: number;
  column: number;
  active: boolean;
  range: Range | null;
};
const DRAG_THRESHOLD_PX = 4;

// "Unavailable" is aria-disabled, not `disabled`: a focused button that becomes disabled loses the keyboard's place,
// and every control is unavailable for the length of a save. Clicks are ignored in the handlers.
const chip =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-border-subtle px-3 text-xs font-medium text-text transition-colors hover:bg-surface-subtle aria-disabled:cursor-not-allowed aria-disabled:opacity-40 lg:min-h-8";

const BAR: { op: NudgeOp; label: string; name: (subject: string) => string; days?: boolean }[] = [
  { op: "earlier", label: "Earlier", name: (s) => `Move ${s} 15 minutes earlier` },
  { op: "later", label: "Later", name: (s) => `Move ${s} 15 minutes later` },
  { op: "shorter", label: "Shorter", name: (s) => `Make ${s} 15 minutes shorter` },
  { op: "longer", label: "Longer", name: (s) => `Make ${s} 15 minutes longer` },
  { op: "previousDay", label: "Previous day", name: (s) => `Move ${s} to the previous day`, days: true },
  { op: "nextDay", label: "Next day", name: (s) => `Move ${s} to the next day`, days: true },
];

function itemStyle(item: GridItem): string {
  if (item.locked) return "border border-border-subtle bg-surface-subtle text-text-muted";
  if (item.kind === "event") return "border border-accent bg-accent-soft text-accent-ink";
  return `border-[1.5px] border-dashed border-border-strong bg-surface ${item.done ? "text-text-faint" : "text-text-muted"}`;
}

/** Where a range sits in its day's column. */
function boxOf(day: number, range: Range): { top: number; height: number } {
  const start = minutesIn(day, range.start);
  return { top: topPx(start), height: Math.max(MIN_HEIGHT_PX, Math.round(topPx(minutesIn(day, range.end) - start)) - GAP_PX) };
}

/** A dashed box over a range of a day: the draft of a drag in progress, or where a dropped task would land. */
function Outline({ day, range, ghost, children }: { day: number; range: Range; ghost?: boolean; children: React.ReactNode }) {
  return (
    <div
      data-drag-ghost={ghost ? "" : undefined}
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0.5 z-[4] box-border overflow-hidden rounded-lg border-[1.5px] border-dashed border-accent bg-accent-soft px-1.5 py-1 text-xs leading-4 text-accent-ink"
      style={boxOf(day, range)}
    >
      {children}
    </div>
  );
}

/** Something that spans days: a link to its own page, over the columns it touches. */
function StripEntry({ item }: { item: StripItem }) {
  return (
    <Link
      href={editHref(item)}
      style={{ gridColumn: `${item.from + 2} / span ${item.to - item.from + 1}` }}
      className="block min-w-0 truncate rounded-md border border-border-subtle bg-surface-subtle px-2 py-0.5 text-xs font-semibold leading-4 text-text-muted transition-colors hover:border-border-strong"
    >
      <span>{item.title}</span>
      <span className="font-normal text-text-faint">
        {" · "}
        {dayLabel(item.start)} to {dayLabel(item.end - 1)}
      </span>
    </Link>
  );
}

/**
 * The hourly week and day grid. A block is picked by clicking it; the bar above the grid then moves it by 15
 * minutes, makes it longer or shorter, or sends it to the next or previous day, which is the way on a touch screen
 * and with a keyboard. A change shows at once and then is made for real, one at a time, as on the board.
 */
export function TimeGrid({
  view,
  days,
  strip,
  nowMs,
}: {
  view: "week" | "day";
  days: GridDay[];
  strip: StripItem[];
  nowMs: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, applyMove] = useOptimistic(days, (state: GridDay[], move: Move) => applyRange(state, move.key, move.range));
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLElement>(null);
  const busy = useRef(false);
  const refocus = useRef<string | null>(null);
  const gesture = useRef<Gesture | null>(null);

  const current = selected ? findItem(shown, selected) : undefined;
  // Lanes change when an item moves, not on every step of a drag.
  const laidOut = useMemo(() => shown.map((day) => layoutDay(day.items)), [shown]);
  const visibleDay = (range: Range) => shown.some((day) => holds(day, range.start));

  // The grid opens at 07:00; the hours before it are above, one scroll away.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = topPx(OPEN_AT_MINUTES);
  }, []);

  // A drag that ends anywhere (dropped, cancelled with Escape, released outside) takes its preview with it, and
  // Escape takes a pointer drag back: nothing is sent, and the block was never moved.
  useEffect(() => {
    const clearPreview = () => setPreview(null);
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || !gesture.current) return;
      gesture.current = null;
      setDraft(null);
    }
    window.addEventListener("dragend", clearPreview);
    window.addEventListener("drop", clearPreview);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("dragend", clearPreview);
      window.removeEventListener("drop", clearPreview);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // A block that changes day is a different element, so focus that was on it would fall back to the top of the
  // page: put it back once the grid has changed. Focus on a bar button is left where it is.
  useEffect(() => {
    const key = refocus.current;
    if (!key || !root.current) return;
    refocus.current = null;
    if (document.activeElement && document.activeElement !== document.body) return;
    root.current.querySelector<HTMLElement>(`[data-focus-key="${key}"]`)?.focus();
  }, [shown]);

  // Dragging is for a mouse or a pen. A finger scrolls and taps; the bar above the grid moves a block for it.
  function begin(event: React.PointerEvent<HTMLButtonElement>, item: GridItem, column: number) {
    if (event.pointerType === "touch" || event.button !== 0 || !event.isPrimary || item.locked) return;
    if (busy.current || pending) return;
    const edge = (event.target as HTMLElement).closest<HTMLElement>("[data-edge]")?.dataset.edge;
    gesture.current = {
      item,
      mode: edge === "start" ? "start" : edge === "end" ? "end" : "move",
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollTop: scroller.current?.scrollTop ?? 0,
      column,
      active: false,
      range: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  /** The column under the pointer; outside the grid it is the nearest one. */
  function columnUnder(clientX: number, fallback: number): number {
    const columnsOnScreen = root.current?.querySelectorAll<HTMLElement>("[data-day-col]");
    if (!columnsOnScreen || columnsOnScreen.length === 0) return fallback;
    for (let index = 0; index < columnsOnScreen.length; index += 1) {
      if (clientX < columnsOnScreen[index].getBoundingClientRect().right) return index;
    }
    return columnsOnScreen.length - 1;
  }

  function follow(event: React.PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointerId) return;
    if (!g.active) {
      if (Math.hypot(event.clientX - g.x, event.clientY - g.y) < DRAG_THRESHOLD_PX) return;
      g.active = true;
      setSelected(g.item.key);
    }
    const scrolled = (scroller.current?.scrollTop ?? 0) - g.scrollTop;
    const minutes = ((event.clientY - g.y + scrolled) * 60) / HOUR_PX;
    const origin = rangeOf(g.item);
    const range =
      g.mode === "move" ? moveRange(origin, minutes, columnUnder(event.clientX, g.column) - g.column) : resizeRange(origin, g.mode, minutes);
    g.range = range;
    setDraft((before) =>
      before && before.range.start === range.start && before.range.end === range.end ? before : { key: g.item.key, title: g.item.title, range },
    );
  }

  function finish(event: React.PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointerId) return;
    gesture.current = null;
    setDraft(null);
    if (g.active && g.range && (g.range.start !== g.item.start || g.range.end !== g.item.end)) save(g.item, g.range);
  }

  function abandon(event: React.PointerEvent<HTMLButtonElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = null;
    setDraft(null);
  }

  /**
   * One change at a time: `move` (if any) shows at once, `work` makes it real, and a refusal is said out loud. If the
   * item is gone (removed in another tab) the grid on screen is what is out of date, so the page is refreshed.
   */
  function change(work: () => Promise<ApiResponse<null>>, options: { move?: Move; focus?: string } = {}) {
    if (busy.current || pending) return;
    busy.current = true;
    if (options.focus) refocus.current = options.focus;
    setError(null);
    startTransition(async () => {
      if (options.move) applyMove(options.move);
      try {
        const result = await work();
        if (!result.success) {
          setError(result.error.message);
          if (result.error.code === "RESOURCE_NOT_FOUND") router.refresh();
        }
      } catch {
        setError("Could not reach the server. Try again.");
      } finally {
        busy.current = false;
      }
    });
  }

  function save(item: GridItem, next: Range) {
    if (item.locked) return;
    change(
      () => (item.kind === "event" ? moveEventAction(item.id, next.start, next.end) : moveTaskBlockAction(item.id, next.start, next.end)),
      { move: { key: item.key, range: next }, focus: item.key },
    );
  }

  function place(taskId: string, range: Range) {
    change(() => scheduleTaskAtAction(taskId, range.start));
  }

  function aim(event: React.DragEvent<HTMLDivElement>, day: GridDay) {
    const minutes = minutesAtY(event.clientY - event.currentTarget.getBoundingClientRect().top);
    const estimate = estimateFromDragTypes(Array.from(event.dataTransfer.types)) ?? DEFAULT_ESTIMATE_MINUTES;
    return dropRange(day.date, minutes, estimate);
  }

  const subject = current ? `"${current.title}"` : "the selected block";
  const columns = shown.length;

  let text = "Select a block to move it.";
  if (current) {
    text = current.locked
      ? `${current.title} is imported, so it is read-only here. Change it in the calendar it came from.`
      : `${current.title} · ${dayLabel(current.start)} · ${formatRange(rangeOf(current))} · ${kindWord(current)}`;
  }

  return (
    <div ref={root} className={`flex min-w-0 flex-col gap-3 ${draft ? "cursor-grabbing" : ""}`}>
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <section aria-label="Selected block" className="flex flex-col gap-2.5 rounded-xl border border-border-subtle bg-surface px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
        <p role="status" className="min-w-0 text-[13px] leading-5 text-text-muted sm:flex-1 sm:basis-56">
          {text}
        </p>
        <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:gap-1.5">
          {BAR.filter((entry) => !entry.days || view === "week").map((entry) => {
            const next = current && !current.locked ? nudge(rangeOf(current), entry.op) : null;
            const available = !!next && !pending && (!entry.days || visibleDay(next));
            return (
              <button
                key={entry.op}
                type="button"
                aria-disabled={!available || undefined}
                aria-label={entry.name(subject)}
                onClick={() => {
                  if (available && current && next) save(current, next);
                }}
                className={chip}
              >
                {entry.label}
              </button>
            );
          })}
          {current && (
            <Link href={editHref(current)} className={`${chip} text-accent-ink`}>
              Edit details
            </Link>
          )}
        </div>
      </section>

      <section ref={scroller} aria-label="Calendar grid" className="relative h-[36rem] overflow-auto rounded-2xl border border-border-subtle bg-surface">
        <div className={view === "week" ? "min-w-[720px]" : ""}>
          <div className="sticky top-0 z-20 border-b border-border-subtle bg-surface">
            <div className="flex">
              <div className="sticky left-0 z-10 w-14 flex-none bg-surface" />
              <div className="grid min-w-0 flex-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                {shown.map((day) => (
                  <div
                    key={day.date}
                    aria-current={day.isToday ? "date" : undefined}
                    className={`px-1 py-2 text-center text-xs font-medium leading-4 ${day.isToday ? "text-accent-ink" : "text-text-muted"}`}
                  >
                    {headLabel(day.date)}
                    {day.isToday && <span className="sr-only"> (today)</span>}
                  </div>
                ))}
              </div>
            </div>
            {strip.length > 0 && (
              <div role="group" aria-label="All day" className="grid gap-x-0.5 gap-y-1 border-t border-border-subtle py-1" style={{ gridTemplateColumns: `3.5rem repeat(${columns}, minmax(0, 1fr))` }}>
                <span aria-hidden="true" className="sticky left-0 z-10 col-start-1 row-span-2 self-start bg-surface pr-2 pt-0.5 text-right text-[11px] leading-4 text-text-faint">
                  All day
                </span>
                {strip.map((item) => (
                  <StripEntry key={item.key} item={item} />
                ))}
              </div>
            )}
          </div>

          <div className="flex">
            <div className="sticky left-0 z-10 w-14 flex-none bg-surface" aria-hidden="true">
              {HOURS.map((hour) => (
                <div key={hour} className="box-border pr-2 text-right text-[11px] leading-4 tabular-nums text-text-faint" style={{ height: HOUR_PX }}>
                  <span className="relative -top-2">{hour}</span>
                </div>
              ))}
            </div>
            <div className="grid min-w-0 flex-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {shown.map((day, columnIndex) => (
                <div
                  key={day.date}
                  data-day-col
                  role="group"
                  aria-label={dayLabel(day.date)}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes(TASK_DRAG_MIME)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const range = aim(event, day);
                    setPreview((before) =>
                      before && before.date === day.date && before.range.start === range.start && before.range.end === range.end ? before : { date: day.date, range },
                    );
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPreview(null);
                  }}
                  onDrop={(event) => {
                    if (!event.dataTransfer.types.includes(TASK_DRAG_MIME)) return;
                    event.preventDefault();
                    setPreview(null);
                    const taskId = event.dataTransfer.getData(TASK_DRAG_MIME);
                    if (taskId) place(taskId, aim(event, day));
                  }}
                  className="relative border-l border-border-subtle"
                  style={{
                    height: HOUR_PX * 24,
                    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--border) ${HOUR_PX - 1}px, var(--border) ${HOUR_PX}px)`,
                  }}
                >
                  {day.isToday && (
                    <>
                      <div data-now-line aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-[2] h-0.5 bg-accent" style={{ top: topPx(minutesIn(day.date, nowMs)) }} />
                      <div aria-hidden="true" className="pointer-events-none absolute -left-[5px] z-[2] size-2.5 rounded-full bg-accent" style={{ top: topPx(minutesIn(day.date, nowMs)) - 4 }} />
                    </>
                  )}

                  {laidOut[columnIndex].map((item) => {
                    const range = formatRange(rangeOf(item));
                    return (
                      <button
                        key={item.key}
                        type="button"
                        data-focus-key={item.key}
                        aria-pressed={selected === item.key}
                        aria-label={`${item.title}, ${dayLabel(item.start)} ${range.replace("–", " to ")}, ${kindWord(item)}${item.done ? ", done" : ""}`}
                        onClick={() => setSelected(item.key)}
                        onPointerDown={(event) => begin(event, item, columnIndex)}
                        onPointerMove={follow}
                        onPointerUp={finish}
                        onPointerCancel={abandon}
                        onLostPointerCapture={abandon}
                        style={{
                          ...boxOf(day.date, rangeOf(item)),
                          left: `${(item.lane * 100) / item.lanes}%`,
                          width: `calc(${100 / item.lanes}% - ${GAP_PX}px)`,
                        }}
                        className={`absolute z-[1] box-border select-none overflow-hidden rounded-lg px-1.5 py-1 text-left text-xs leading-4 outline-offset-1 transition-colors ${itemStyle(item)} ${
                          item.locked ? "cursor-default" : "cursor-grab"
                        } ${selected === item.key ? "outline-2 outline-accent" : ""} ${draft?.key === item.key ? "opacity-40" : ""}`}
                      >
                        <span className={`block font-semibold ${item.done ? "line-through" : ""}`}>
                          {item.locked && <Icon name="lock" className="mr-1 inline size-[11px] align-[-1px]" strokeWidth={2.2} />}
                          {item.recurring && "↻ "}
                          {item.title}
                        </span>
                        <span className="block tabular-nums">{range}</span>
                        {!item.locked && (
                          <>
                            <span data-edge="start" aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize" />
                            <span data-edge="end" aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize" />
                          </>
                        )}
                        {selected === item.key && !item.locked && (
                          <>
                            <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-0.5 -ml-3 h-[3px] w-6 rounded-sm bg-accent" />
                            <span aria-hidden="true" className="pointer-events-none absolute bottom-0.5 left-1/2 -ml-3 h-[3px] w-6 rounded-sm bg-accent" />
                          </>
                        )}
                      </button>
                    );
                  })}

                  {draft && holds(day, draft.range.start) && (
                    <Outline day={day.date} range={draft.range} ghost>
                      <span className="block font-semibold">{draft.title}</span>
                      <span className="block tabular-nums">{formatRange(draft.range)}</span>
                    </Outline>
                  )}

                  {preview && preview.date === day.date && (
                    <Outline day={day.date} range={preview.range}>
                      <span className="font-medium">Drops at {formatRange(preview.range)}</span>
                    </Outline>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
