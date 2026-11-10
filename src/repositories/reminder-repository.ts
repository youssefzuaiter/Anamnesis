import "server-only";
import { prisma } from "@/lib/prisma";
import type { PushPrefs } from "@/lib/reminder-schedule";

export type PushProfile = { enabled: boolean; prefs: PushPrefs; topic: string | null };

const PUSH_COLUMNS = {
  pushEnabled: true,
  pushLeadMinutes: true,
  pushDigestHour: true,
  pushShowTitles: true,
  ntfyTopic: true,
} as const;

function toPushProfile(row: {
  pushEnabled: boolean;
  pushLeadMinutes: number;
  pushDigestHour: number;
  pushShowTitles: boolean;
  ntfyTopic: string | null;
}): PushProfile {
  return {
    enabled: row.pushEnabled,
    prefs: { leadMinutes: row.pushLeadMinutes, digestHour: row.pushDigestHour, showTitles: row.pushShowTitles },
    topic: row.ntfyTopic,
  };
}

export async function getPushProfile(userId: string): Promise<PushProfile | null> {
  const row = await prisma.userProfile.findUnique({ where: { userId }, select: PUSH_COLUMNS });
  return row ? toPushProfile(row) : null;
}

export async function savePushProfile(
  userId: string,
  data: { pushEnabled: boolean; pushLeadMinutes: number; pushDigestHour: number; pushShowTitles: boolean },
): Promise<void> {
  // upsert because a profile row may not exist for an account that never opened Settings.
  await prisma.userProfile.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

/** Sets the topic only if there is none yet, so turning push off and on again keeps the phone's subscription. */
export async function setTopicIfMissing(userId: string, topic: string): Promise<void> {
  await prisma.userProfile.updateMany({ where: { userId, ntfyTopic: null }, data: { ntfyTopic: topic } });
}

/** Every account that has push on and a topic to send to. */
export async function listPushAccounts(): Promise<{ userId: string; topic: string; prefs: PushPrefs }[]> {
  const rows = await prisma.userProfile.findMany({
    where: { pushEnabled: true, ntfyTopic: { not: null } },
    select: { userId: true, ...PUSH_COLUMNS },
  });
  return rows.map((row) => ({ userId: row.userId, topic: row.ntfyTopic!, prefs: toPushProfile(row).prefs }));
}

/** Open tasks of this account due by `endOfDay` (overdue ones included), oldest due first. */
export async function listDueToday(userId: string, endOfDay: Date): Promise<{ id: string; title: string }[]> {
  return prisma.task.findMany({
    where: { userId, deletedAt: null, status: { not: "done" }, dueDate: { lte: endOfDay } },
    select: { id: true, title: true },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    take: 50,
  });
}

/** Events, and open planned tasks, of this account that start after `from` and no later than `to`. */
export async function listStarting(
  userId: string,
  from: Date,
  to: Date,
): Promise<{ kind: "event" | "task"; id: string; title: string; start: Date }[]> {
  const [events, tasks] = await Promise.all([
    prisma.event.findMany({
      where: { userId, startTime: { gt: from, lte: to } },
      select: { id: true, title: true, startTime: true },
      take: 50,
    }),
    prisma.task.findMany({
      where: { userId, deletedAt: null, status: { not: "done" }, scheduledStart: { gt: from, lte: to } },
      select: { id: true, title: true, scheduledStart: true },
      take: 50,
    }),
  ]);
  return [
    ...events.map((event) => ({ kind: "event" as const, id: event.id, title: event.title, start: event.startTime })),
    ...tasks.map((task) => ({ kind: "task" as const, id: task.id, title: task.title, start: task.scheduledStart! })),
  ];
}

export const MAX_ATTEMPTS = 3;

/**
 * Claims one reminder for sending; null means another tick has it, or it is done, or it has run out of
 * attempts. The first claim is the row's creation (the unique key decides who wins). A retry is claimed by
 * one conditional update that clears `lastError`: a failed row has an error, a row in flight has none, so
 * two schedulers can never retry the same reminder at once.
 */
export async function claimDelivery(userId: string, key: string, now: Date): Promise<{ id: string } | null> {
  try {
    // Dated by the tick's clock, the same one pruning compares against.
    return await prisma.reminderDelivery.create({ data: { userId, key, attempts: 1, createdAt: now }, select: { id: true } });
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
  }
  const { count } = await prisma.reminderDelivery.updateMany({
    where: { userId, key, sentAt: null, lastError: { not: null }, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 }, lastError: null },
  });
  if (count === 0) return null;
  return prisma.reminderDelivery.findUnique({ where: { userId_key: { userId, key } }, select: { id: true } });
}

export async function markSent(id: string, at: Date): Promise<void> {
  // The claim already cleared any earlier error.
  await prisma.reminderDelivery.update({ where: { id }, data: { sentAt: at } });
}

export async function markFailed(id: string, message: string): Promise<void> {
  await prisma.reminderDelivery.update({ where: { id }, data: { lastError: message.slice(0, 200) } });
}

/**
 * Why the newest reminder failed, if it did: once a later reminder has gone through, an older failure is
 * history and is not shown. (A delivered row has no error: the retry that delivered it cleared it.)
 */
export async function lastFailure(userId: string): Promise<string | null> {
  const newest = await prisma.reminderDelivery.findFirst({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { lastError: true },
  });
  return newest?.lastError ?? null;
}

export async function pruneDeliveries(before: Date): Promise<number> {
  const { count } = await prisma.reminderDelivery.deleteMany({ where: { createdAt: { lt: before } } });
  return count;
}
