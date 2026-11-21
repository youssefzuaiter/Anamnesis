"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyWeekAction, proposeWeekAction } from "@/actions/week-plan";
import type { WeekProposal } from "@/services/week-plan-service";

type View = "rows" | "grid";

const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const SHORT_DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric" });
const PX_PER_HOUR = 56;

const BUTTON = "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors disabled:opacity-60 sm:min-h-10";
const localDay = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const hoursText = (minutes: number) => { const h = Math.floor(minutes / 60); const m = minutes % 60; return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m}`; };
const range = (start: string, end: string) => `${TIME.format(new Date(start))} to ${TIME.format(new Date(end))}`;
const sameDay = (iso: string, day: string) => { const d = new Date(iso); return localDay(day).toDateString() === d.toDateString(); };
const dueText = (iso: string | null) => (iso ? `due ${WEEKDAY.format(new Date(iso))}` : null);
const PRIORITY: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };

/**
 * Plan my week (ROADMAP item 51): one proposal in two views, day rows (the main one) and blocks drawn on the week grid. Ticking is by task, so a
 * block left out in one view is left out in the other. Nothing is saved until Schedule; only task ids and start times are sent back.
 */
export function PlanWeek({ weekStart, weekLabel }: { weekStart: string; weekLabel: string }) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, startTransition] = useTransition();
  const [proposal, setProposal] = useState<WeekProposal | null>(null);
  const [left, setLeft] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>("rows");
  const [dayIndex, setDayIndex] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const ticked = proposal?.blocks.filter((b) => !left.has(b.taskId)) ?? [];
  const toggle = (taskId: string) => setLeft((cur) => { const next = new Set(cur); if (next.has(taskId)) next.delete(taskId); else next.add(taskId); return next; });

  function propose() {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setMessage(null);
    setWorking(true);
    startTransition(async () => {
      try {
        const result = await proposeWeekAction(weekStart);
        if (!result.success) return void setError(result.error.message);
        setProposal(result.data);
        setLeft(new Set());
        const first = result.data.days.findIndex((d) => result.data.blocks.some((b) => sameDay(b.start, d.date)));
        setDayIndex(first === -1 ? 0 : first);
        if (result.data.blocks.length === 0) {
          setMessage(result.data.unplaced.length > 0
            ? `No gap in this week fits the ${result.data.unplaced.length} open ${result.data.unplaced.length === 1 ? "task" : "tasks"}. Try another week, or free some time.`
            : "Every open task already has a time, or there are none. Nothing to plan this week.");
        }
      } catch {
        setError("Could not reach the server. Try again.");
      } finally {
        busy.current = false;
        setWorking(false);
      }
    });
  }

  function schedule() {
    if (busy.current || !proposal || ticked.length === 0) return;
    busy.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await applyWeekAction(weekStart, ticked.map((b) => ({ taskId: b.taskId, start: b.start })));
        if (!result.success) return void setError(result.error.message);
        const { scheduled, requested } = result.data;
        setProposal(null);
        setMessage(scheduled === requested
          ? `Scheduled ${scheduled} ${scheduled === 1 ? "task" : "tasks"}. They show on the week grid as dashed blocks.`
          : `Scheduled ${scheduled} of the ${requested} tasks you ticked: the other ${requested - scheduled} no longer fit. Propose again to place the rest.`);
        router.refresh();
      } catch {
        setError("Could not reach the server. Try again.");
      } finally {
        busy.current = false;
      }
    });
  }

  return (
    <section aria-labelledby="plan-week-h" className="rounded-xl border border-border-subtle bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-56 flex-1">
          <h2 id="plan-week-h" className="text-base font-semibold text-text">Plan my week</h2>
          <p className="mt-1 max-w-xl text-[13px] text-text-muted">Spreads your open tasks that have no time yet across the free time of {weekLabel}. Nothing moves until you confirm.</p>
        </div>
        <button type="button" onClick={propose} disabled={pending} className={`${BUTTON} border border-border-strong text-text hover:bg-surface-subtle`}>
          {working ? "Working…" : proposal ? "Propose again" : "Propose a plan"}
        </button>
      </div>

      <p role="status" className="mt-3 text-[13px] text-text-muted empty:hidden">
        {proposal ? `${proposal.blocks.length} ${proposal.blocks.length === 1 ? "task" : "tasks"} placed on ${new Set(proposal.blocks.map((b) => b.start.slice(0, 10))).size} days.${proposal.unplaced.length > 0 ? ` ${proposal.unplaced.length} did not fit.` : ""} Untick any you want to leave out.` : message}
      </p>
      {error && <p role="alert" className="mt-2 text-[13px] font-semibold text-danger">{error}</p>}

      {proposal && proposal.blocks.length > 0 && (
        <div className="mt-3 flex flex-col gap-3">
          <div role="group" aria-label="View" className="inline-flex w-fit rounded-lg border border-border-strong p-0.5">
            {(["rows", "grid"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`min-h-11 rounded-md px-4 text-sm font-semibold sm:min-h-9 ${view === v ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:text-text"}`}>
                {v === "rows" ? "Rows" : "Grid"}
              </button>
            ))}
          </div>
          {view === "rows" ? <Rows proposal={proposal} left={left} toggle={toggle} /> : <Grid proposal={proposal} left={left} toggle={toggle} dayIndex={dayIndex} setDayIndex={setDayIndex} />}
        </div>
      )}

      {proposal && proposal.unplaced.length > 0 && (
        <div className="mt-3 rounded-xl border border-border-subtle bg-surface-subtle px-3.5 py-3">
          <p className="text-sm font-semibold text-warn">{proposal.unplaced.length} {proposal.unplaced.length === 1 ? "task" : "tasks"} did not fit</p>
          <ul className="mt-1 flex flex-col gap-1 text-[13px] text-text">
            {proposal.unplaced.map((u) => (
              <li key={u.taskId}>
                “{u.title}” ({hoursText(u.minutes)}{u.dueDate ? `, ${dueText(u.dueDate)}` : ""}):{" "}
                {u.reason === "before-due" ? "no day before its due day has a free gap that long." : "no day this week has a free gap that long, or the six-hour limit is reached."} Shorten its estimate, move something, or plan it by hand.
              </li>
            ))}
          </ul>
        </div>
      )}

      {proposal && proposal.blocks.length > 0 && (
        <>
          <p className="mt-3 text-xs text-text-muted">Highest priority first, then soonest due. A task due this week goes on or before its due day, on the lightest day that fits. At most 6 hours of planned tasks a day, 09:00 to 21:00, 10 minutes between blocks, never in the past. A task is never shortened or split.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={schedule} disabled={pending || ticked.length === 0} className={`${BUTTON} bg-accent text-on-accent hover:bg-accent-hover`}>
              {pending && !working ? "Scheduling…" : `Schedule ${ticked.length} ${ticked.length === 1 ? "task" : "tasks"}`}
            </button>
            <button type="button" disabled={pending} onClick={() => { setProposal(null); setMessage(null); }} className={`${BUTTON} border border-border-strong text-text hover:bg-surface-subtle`}>Cancel</button>
          </div>
        </>
      )}
    </section>
  );
}

type ViewProps = { proposal: WeekProposal; left: Set<string>; toggle: (taskId: string) => void };

function Rows({ proposal, left, toggle }: ViewProps) {
  const days = proposal.days.filter((d) => proposal.blocks.some((b) => sameDay(b.start, d.date)));
  const quiet = proposal.days.filter((d) => !days.includes(d));
  return (
    <ul className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
      {days.map((day) => {
        const blocks = proposal.blocks.filter((b) => sameDay(b.start, day.date));
        const planned = blocks.filter((b) => !left.has(b.taskId)).reduce((sum, b) => sum + b.minutes, 0);
        return (
          <li key={day.date} className="grid gap-2 px-3.5 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
            <div>
              <p className="text-sm font-semibold text-text">{DAY.format(localDay(day.date))}</p>
              <p className="text-xs text-text-muted">{day.bookedMinutes > 0 ? `${hoursText(day.bookedMinutes)} booked` : "nothing booked"}</p>
              <p className="text-xs font-semibold text-accent-ink">{hoursText(planned)} planned</p>
            </div>
            <ul className="flex flex-col gap-1">
              {blocks.map((b) => (
                <li key={b.taskId}>
                  <label className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-0.5 sm:min-h-0 sm:py-1.5">
                    <input type="checkbox" checked={!left.has(b.taskId)} onChange={() => toggle(b.taskId)} className="h-5 w-5 accent-[var(--accent)]" aria-label={`Schedule ${b.title}`} />
                    <span className="w-[7.5rem] text-[13px] tabular-nums text-text">{range(b.start, b.end)}</span>
                    <span className="min-w-0 flex-1 break-words text-sm font-semibold text-text">{b.title}</span>
                    <span className={`text-xs ${b.priority === "high" ? "font-semibold text-warn" : "text-text-muted"}`}>{PRIORITY[b.priority] ?? b.priority}{b.dueDate ? ` · ${dueText(b.dueDate)}` : ""}</span>
                  </label>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
      {quiet.length > 0 && (
        <li className="bg-surface-subtle px-3.5 py-3 text-[13px] text-text-muted">
          Nothing planned on {quiet.map((d) => SHORT_DAY.format(localDay(d.date))).join(", ")}.
        </li>
      )}
    </ul>
  );
}

function Grid({ proposal, left, toggle, dayIndex, setDayIndex }: ViewProps & { dayIndex: number; setDayIndex: (i: number) => void }) {
  const all = [...proposal.blocks, ...proposal.booked];
  const startHour = Math.min(9, ...all.map((x) => new Date(x.start).getHours()));
  const endHour = Math.max(17, ...all.map((x) => { const e = new Date(x.end); return e.getHours() + (e.getMinutes() > 0 ? 1 : 0); }));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const top = (iso: string) => { const d = new Date(iso); return ((d.getHours() - startHour) * 60 + d.getMinutes()) * (PX_PER_HOUR / 60); };
  const height = (a: string, b: string) => Math.max(22, (new Date(b).getTime() - new Date(a).getTime()) / 60_000 * (PX_PER_HOUR / 60) - 2);
  const total = hours.length * PX_PER_HOUR;

  return (
    <div>
      <div role="tablist" aria-label="Day" className="mb-2 grid grid-cols-7 gap-1 md:hidden">
        {proposal.days.map((d, i) => {
          const n = proposal.blocks.filter((b) => sameDay(b.start, d.date) && !left.has(b.taskId)).length;
          return (
            <button key={d.date} type="button" role="tab" aria-selected={i === dayIndex} onClick={() => setDayIndex(i)} className={`flex min-h-12 flex-col items-center justify-center rounded-lg border text-xs ${i === dayIndex ? "border-accent bg-accent-soft font-semibold text-accent-ink" : "border-control text-text"}`}>
              {WEEKDAY.format(localDay(d.date))}
              <span className="text-[11px] text-text-muted">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] overflow-hidden rounded-xl border border-border-subtle md:grid-cols-[2.5rem_repeat(7,minmax(0,1fr))]">
        <div aria-hidden className="relative bg-surface-subtle" style={{ height: total + 34 }}>
          {hours.map((h, i) => <span key={h} className="absolute left-1 text-[11px] text-text-muted" style={{ top: 34 + i * PX_PER_HOUR - 7 }}>{String(h).padStart(2, "0")}:00</span>)}
        </div>
        {proposal.days.map((d, i) => (
          <div key={d.date} className={`${i === dayIndex ? "" : "hidden"} border-l border-border-subtle md:block`}>
            <p className="flex h-[34px] items-center justify-center bg-surface-subtle px-1 text-xs font-semibold text-text">{SHORT_DAY.format(localDay(d.date))}</p>
            <div className="relative" style={{ height: total }}>
              {hours.map((h, k) => <div key={h} className="absolute inset-x-0 border-t border-border-subtle" style={{ top: k * PX_PER_HOUR }} />)}
              {proposal.booked.filter((x) => sameDay(x.start, d.date)).map((x, k) => (
                <div key={`${x.title}-${k}`} className="absolute inset-x-0.5 overflow-hidden rounded-md bg-surface-hover px-1.5 py-0.5 text-[11px] leading-tight text-text" style={{ top: top(x.start), height: height(x.start, x.end) }}>
                  {x.title}<br />{range(x.start, x.end)}
                </div>
              ))}
              {proposal.blocks.filter((b) => sameDay(b.start, d.date)).map((b) => {
                const off = left.has(b.taskId);
                return (
                  <button key={b.taskId} type="button" aria-pressed={!off} aria-label={`${b.title}, ${range(b.start, b.end)}: ${off ? "left out" : "will be scheduled"}`} onClick={() => toggle(b.taskId)} className={`absolute inset-x-0.5 overflow-hidden rounded-md border-2 border-dashed px-1.5 py-0.5 text-left text-[11px] font-semibold leading-tight ${off ? "border-control text-text-muted" : "border-accent bg-accent-soft text-accent-ink"}`} style={{ top: top(b.start), height: height(b.start, b.end) }}>
                    {off ? "" : "✓ "}{b.title}<br /><span className="font-normal">{range(b.start, b.end)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-text-muted">Grey is already booked. A dashed block is proposed: press it to leave it out.</p>
    </div>
  );
}
