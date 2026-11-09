import "server-only";
import { prisma } from "@/lib/prisma";
import type { EventModel as Event } from "@/generated/prisma/models";

export type EventInput = {
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  location: string | null;
  projectId: string | null;
  recurrenceId?: string | null;
};

export async function listEventsInRange(
  userId: string,
  from: Date,
  to: Date,
): Promise<Event[]> {
  return prisma.event.findMany({
    // An event counts as inside the window if it overlaps it at all, not only if
    // it starts inside — otherwise a multi-day event vanishes from every month
    // after the one it began in.
    where: { userId, startTime: { lt: to }, endTime: { gt: from } },
    orderBy: { startTime: "asc" },
  });
}

export async function listUpcomingEvents(
  userId: string,
  from: Date,
  take: number,
): Promise<Event[]> {
  return prisma.event.findMany({
    where: { userId, endTime: { gte: from } },
    orderBy: { startTime: "asc" },
    take,
  });
}

export async function getEvent(
  userId: string,
  eventId: string,
): Promise<Event | null> {
  return prisma.event.findFirst({ where: { id: eventId, userId } });
}

export async function createEvent(
  userId: string,
  input: EventInput,
): Promise<Event> {
  return prisma.event.create({ data: { ...input, userId } });
}

export async function updateEvent(
  userId: string,
  eventId: string,
  input: EventInput,
): Promise<Event | null> {
  const { count } = await prisma.event.updateMany({
    where: { id: eventId, userId },
    data: input,
  });
  if (count === 0) return null;
  return getEvent(userId, eventId);
}

/**
 * Sets only an event's two times. An imported event (one with a `subscriptionId`) is never written here: the feed
 * it came from would put it back at the next sync, so the where refuses it as well as the service.
 */
export async function setEventTimes(
  userId: string,
  eventId: string,
  start: Date,
  end: Date,
): Promise<Event | null> {
  const { count } = await prisma.event.updateMany({
    where: { id: eventId, userId, subscriptionId: null },
    data: { startTime: start, endTime: end },
  });
  if (count === 0) return null;
  return getEvent(userId, eventId);
}

// Event has no deletedAt in the schema, so this is a hard delete.
export async function deleteEvent(
  userId: string,
  eventId: string,
): Promise<boolean> {
  const { count } = await prisma.event.deleteMany({
    where: { id: eventId, userId },
  });
  return count > 0;
}

/** Ids of this and every later occurrence in the same recurring series. */
export async function listSeriesEventIds(
  userId: string,
  recurrenceId: string,
  from: Date,
): Promise<string[]> {
  const rows = await prisma.event.findMany({
    where: { userId, recurrenceId, startTime: { gte: from } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * This account's other occurrences of a series that start at or after `from`, in order: the rows an edit of one
 * occurrence may carry to the later ones. An imported event is never part of a series and is left out here too.
 */
export async function listLaterSeriesEvents(
  userId: string,
  recurrenceId: string,
  from: Date,
  exceptId: string,
): Promise<Event[]> {
  return prisma.event.findMany({
    where: { userId, recurrenceId, subscriptionId: null, startTime: { gte: from }, id: { not: exceptId } },
    orderBy: [{ startTime: "asc" }, { id: "asc" }],
  });
}

/**
 * The caller's own events that overlap the window, for the calendar feed. Events imported from a
 * subscription are left out (they are already in the phone, from their source), and only the columns
 * the feed shows are read: a description never leaves the database for it.
 */
export async function listFeedEvents(userId: string, from: Date, to: Date, take: number) {
  return prisma.event.findMany({
    where: { userId, subscriptionId: null, startTime: { lt: to }, endTime: { gt: from } },
    orderBy: [{ startTime: "asc" }, { id: "asc" }],
    take,
    select: { id: true, title: true, location: true, startTime: true, endTime: true, updatedAt: true },
  });
}

