import "server-only";
import { AppError } from "@/lib/api-response";
import { assertPublicUrl, safeFetchText, SafeFetchError } from "@/lib/safe-fetch";
import { parseIcs, MAX_EVENTS_PER_FEED } from "@/lib/ics";
import { deleteEntityEmbeddings } from "@/lib/vector";
import { indexEvent } from "@/services/event-service";
import * as calendarRepository from "@/repositories/calendar-repository";
import type { CalendarSubscriptionModel as CalendarSubscription } from "@/generated/prisma/models";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_FEED_BYTES = 5 * 1024 * 1024;

/**
 * A timetable repeats the same handful of course titles every week, so
 * embedding a whole year of occurrences would fill the retrieval window with
 * near-duplicates and crowd out the user's own notes. Only the next few weeks
 * are indexed — enough for "when is my next lecture", without the flood.
 */
const INDEXED_UPCOMING = 25;

/** A calendar link is a URL the server fetches: the shared guard decides what it may reach. */
function assertFetchableUrl(raw: string): URL {
  return assertPublicUrl(raw, ["http:", "https:", "webcal:"]);
}

async function fetchFeed(url: URL): Promise<string> {
  let text: string;
  try {
    ({ text } = await safeFetchText(url, {
      maxBytes: MAX_FEED_BYTES,
      timeoutMs: FETCH_TIMEOUT_MS,
      accept: "text/calendar, text/plain;q=0.9, */*;q=0.8",
      // Feeds are served under many types (text/calendar, text/plain, application/octet-stream); what
      // decides is the BEGIN:VCALENDAR check below.
      allow: () => true,
    }));
  } catch (error) {
    if (!(error instanceof SafeFetchError)) throw error;
    if (error.kind === "blocked") throw error;
    if (error.kind === "too-large") throw new AppError("VALIDATION_ERROR", "That calendar file is too large.");
    if (error.kind === "status") throw new AppError("INTEGRATION_ERROR", `The calendar returned ${error.status}.`);
    throw new AppError("INTEGRATION_ERROR", "Could not reach that calendar. Check the link and try again.");
  }

  if (!text.includes("BEGIN:VCALENDAR")) {
    throw new AppError(
      "INTEGRATION_ERROR",
      "That link did not return a calendar file.",
    );
  }
  return text;
}

export type SyncResult = { imported: number; removed: number };

/**
 * Re-reads the feed and makes the imported events match it: new classes are
 * added, changed ones updated in place, and cancelled ones removed. Safe to
 * run repeatedly — the (subscription, uid) key makes it idempotent.
 */
export async function syncSubscription(
  userId: string,
  subscriptionId: string,
): Promise<SyncResult> {
  const subscription = await calendarRepository.getSubscription(
    userId,
    subscriptionId,
  );
  if (!subscription) {
    throw new AppError("RESOURCE_NOT_FOUND", "That calendar is not connected.");
  }

  const text = await fetchFeed(assertFetchableUrl(subscription.url));
  const parsed = parseIcs(text);

  if (parsed.length === 0) {
    throw new AppError(
      "INTEGRATION_ERROR",
      "No events could be read from that calendar.",
    );
  }

  // A feed may legitimately repeat a UID across instances; the last one wins
  // rather than the upsert racing itself within a single sync.
  const byUid = new Map(parsed.map((event) => [event.uid, event]));

  for (const event of byUid.values()) {
    await calendarRepository.upsertFeedEvent(userId, subscriptionId, {
      externalUid: event.uid,
      title: event.title,
      description: event.description,
      location: event.location,
      startTime: event.start,
      endTime: event.end,
    });
  }

  const removedIds = await calendarRepository.deleteStaleFeedEvents(
    userId,
    subscriptionId,
    [...byUid.keys()],
  );
  for (const id of removedIds) {
    await deleteEntityEmbeddings(userId, "event", id);
  }

  await calendarRepository.markSynced(userId, subscriptionId, byUid.size);

  const upcoming = await calendarRepository.listUpcomingFeedEvents(
    userId,
    subscriptionId,
    new Date(),
    INDEXED_UPCOMING,
  );
  for (const event of upcoming) {
    await indexEvent(userId, event);
  }

  return { imported: byUid.size, removed: removedIds.length };
}

export async function addSubscription(
  userId: string,
  input: { name: string; url: string },
): Promise<{ subscription: CalendarSubscription; result: SyncResult }> {
  const url = assertFetchableUrl(input.url);

  const subscription = await calendarRepository.createSubscription(userId, {
    name: input.name,
    url: url.toString(),
  });

  try {
    const result = await syncSubscription(userId, subscription.id);
    return { subscription, result };
  } catch (error) {
    // A feed that cannot be read is not a calendar worth keeping a row for —
    // otherwise a typo leaves a permanently broken entry in the list.
    await calendarRepository.deleteSubscription(userId, subscription.id);
    throw error;
  }
}

export async function removeSubscription(
  userId: string,
  subscriptionId: string,
): Promise<void> {
  const events = await calendarRepository.listUpcomingFeedEvents(
    userId,
    subscriptionId,
    new Date(0),
    MAX_EVENTS_PER_FEED,
  );

  const removed = await calendarRepository.deleteSubscription(
    userId,
    subscriptionId,
  );
  if (!removed) {
    throw new AppError("RESOURCE_NOT_FOUND", "That calendar is not connected.");
  }

  // The events cascade with the subscription, but their embeddings do not.
  for (const event of events) {
    await deleteEntityEmbeddings(userId, "event", event.id);
  }
}

export async function listSubscriptions(
  userId: string,
): Promise<CalendarSubscription[]> {
  return calendarRepository.listSubscriptions(userId);
}
