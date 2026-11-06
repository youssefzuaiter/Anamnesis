// The rules of the calendar feed: the token, the window and what becomes a calendar entry. Pure:
// no database. The feed is a bearer secret (whoever holds the address reads it), so it carries the
// least that is useful on a phone: titles, times and an event's place.

import { createHash, randomBytes } from "node:crypto";
import { buildIcs, type IcsItem } from "@/lib/ics-write";

export const FEED_WINDOW = { daysBack: 30, daysAhead: 365, maxItems: 2000 };
const DAY_MS = 86_400_000;

/** What the feed shows: from 30 days ago (so a week of "what did I miss" stays) to a year ahead. */
export function feedWindow(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() - FEED_WINDOW.daysBack * DAY_MS),
    to: new Date(now.getTime() + FEED_WINDOW.daysAhead * DAY_MS),
  };
}

// --- the token ----------------------------------------------------------------------------------

/** 32 random bytes as base64url: 256 bits, 43 characters, safe in a path. */
export function newFeedToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * What is stored instead of the token. A token has the entropy of a key, so a fast hash is enough:
 * there is nothing to guess a preimage from, and the stored value does not let anyone build the address.
 */
export function hashFeedToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** Whether a value could be a token at all: checked before any hash or query, so junk costs nothing. */
export function isFeedTokenShape(value: string): boolean {
  return value.length === 43 && TOKEN_SHAPE.test(value);
}

/** The token in `<token>.ics`, or null for anything else (no suffix, another case, a longer name). */
export function tokenFromFile(file: string): string | null {
  if (!file.endsWith(".ics")) return null;
  const token = file.slice(0, -".ics".length);
  return isFeedTokenShape(token) ? token : null;
}

// --- what becomes a calendar entry --------------------------------------------------------------

export type FeedEvent = { id: string; title: string; location: string | null; startTime: Date; endTime: Date; updatedAt: Date };
export type FeedTask = {
  id: string;
  title: string;
  dueDate: Date | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  estimatedMinutes: number;
  updatedAt: Date;
};

/**
 * Events are events. A task becomes an event too, because a phone calendar shows events (Google
 * Calendar ignores a to-do and Apple files it in Reminders): its planned block as a timed entry, or
 * with only a due date an all-day entry on that local day. Both are free time, so a task never makes
 * the person look busy, and are titled so they are not mistaken for an appointment. A block counts
 * only if it starts inside the window; a task planned long ago and never done shows by its due date
 * (if that is inside the window) or not at all. A task with a current block and a due date is the block
 * alone. The stamp is when the row last changed, so a fetch of an unchanged account is byte for byte
 * the same.
 */
export function feedItems(events: FeedEvent[], tasks: FeedTask[], window: { from: Date; to: Date }): IcsItem[] {
  const inside = (date: Date) => date >= window.from && date < window.to;
  const items: IcsItem[] = events.map((e) => ({
    uid: `event-${e.id}@anamnesis`,
    summary: e.title,
    location: e.location,
    start: e.startTime,
    end: e.endTime,
    stamp: e.updatedAt,
  }));

  for (const t of tasks) {
    if (t.scheduledStart && inside(t.scheduledStart)) {
      items.push({
        uid: `task-${t.id}@anamnesis`,
        summary: `Task: ${t.title}`,
        start: t.scheduledStart,
        end: t.scheduledEnd ?? new Date(t.scheduledStart.getTime() + t.estimatedMinutes * 60_000),
        stamp: t.updatedAt,
        transparent: true,
        category: "Task",
      });
    } else if (t.dueDate && inside(t.dueDate)) {
      items.push({
        uid: `task-${t.id}@anamnesis`,
        summary: `Due: ${t.title}`,
        start: new Date(t.dueDate.getFullYear(), t.dueDate.getMonth(), t.dueDate.getDate()),
        end: new Date(t.dueDate.getFullYear(), t.dueDate.getMonth(), t.dueDate.getDate() + 1),
        allDay: true,
        stamp: t.updatedAt,
        transparent: true,
        category: "Task",
      });
    }
  }
  return items;
}

export function renderFeed(events: FeedEvent[], tasks: FeedTask[], window: { from: Date; to: Date }): string {
  return buildIcs(feedItems(events, tasks, window), { name: "Anamnesis" });
}
