import "server-only";
import { AppError } from "@/lib/api-response";
import { FEED_WINDOW, feedWindow, hashFeedToken, isFeedTokenShape, newFeedToken, renderFeed } from "@/lib/calendar-feed";
import * as eventRepository from "@/repositories/event-repository";
import * as profileRepository from "@/repositories/profile-repository";
import * as taskRepository from "@/repositories/task-repository";

/**
 * The calendar feed: a read-only `.ics` address with an unguessable token, so a phone calendar shows
 * the account's events and open dated tasks. The address is a bearer secret. Only the SHA-256 of the
 * token is stored, so a copy of the database cannot rebuild it, and the token itself exists only in the
 * return value of `createFeedLink`, once. There is one link per account: making another replaces it.
 *
 * `buildFeedForToken` is the one entry that is not behind a session: it turns a token into a user and
 * then reads only that user's rows. What it returns is the least that is useful on a phone (titles,
 * times, an event's place), the rules are in `lib/calendar-feed.ts`.
 */

/** A session always gives a string; a missing id must never reach a query (in Prisma `undefined` means no filter). */
function assertAccount(userId: unknown): asserts userId is string {
  if (typeof userId !== "string" || userId === "") throw new AppError("VALIDATION_ERROR", "A calendar feed needs an account.");
}

/** Makes the account's link, or replaces it: the old address stops working at once. The token is returned once and never stored. */
export async function createFeedLink(userId: string): Promise<{ token: string; createdAt: Date }> {
  assertAccount(userId);
  const token = newFeedToken();
  const createdAt = new Date();
  await profileRepository.setFeedHash(userId, hashFeedToken(token), createdAt);
  return { token, createdAt };
}

/** Turns the link off. Turning off what is off is fine. */
export async function revokeFeedLink(userId: string): Promise<void> {
  assertAccount(userId);
  await profileRepository.setFeedHash(userId, null, new Date());
}

export async function getFeedLinkStatus(userId: string): Promise<{ active: boolean; createdAt: Date | null }> {
  assertAccount(userId);
  return profileRepository.getFeedStatus(userId);
}

/**
 * The calendar for a token, or null for anything that is not a live token (malformed, unknown, turned
 * off: the caller must treat all of them alike). The shape is checked before any hash or query.
 */
export async function buildFeedForToken(token: string, now: Date = new Date()): Promise<string | null> {
  if (typeof token !== "string" || !isFeedTokenShape(token)) return null;
  const userId = await profileRepository.findUserIdByFeedHash(hashFeedToken(token));
  if (userId === null) return null;
  const { from, to } = feedWindow(now);
  const [events, tasks] = await Promise.all([
    eventRepository.listFeedEvents(userId, from, to, FEED_WINDOW.maxItems),
    taskRepository.listFeedTasks(userId, from, to, FEED_WINDOW.maxItems),
  ]);
  return renderFeed(events, tasks, { from, to });
}
