import "server-only";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { deviceLabel } from "@/lib/device-label";

/**
 * Which browsers and devices are signed in (ROADMAP item 27). A sign-in token carries the id of a row
 * here; the Auth.js `jwt` callback asks `isSessionValid` on every request, so ending a session (deleting
 * its row) takes effect on that session's very next request, in pages, actions and routes alike.
 */
export const MAX_SESSIONS = 50;
/** A session not seen for this long is gone: it matches the token's own 30-day life. */
const IDLE_MS = 30 * 24 * 60 * 60 * 1000;
/** `lastSeenAt` is written at most this often, so a page that checks six times writes at most once. */
export const TOUCH_EVERY_MS = 5 * 60 * 1000;

/** A new session for a sign-in; also drops idle ones and keeps only the newest `MAX_SESSIONS`. */
export async function startSession(userId: string, userAgent: string | null, now: Date = new Date()): Promise<string> {
  const session = await prisma.authSession.create({
    data: { userId, device: deviceLabel(userAgent), createdAt: now, lastSeenAt: now },
    select: { id: true },
  });
  await prisma.authSession.deleteMany({
    where: { userId, id: { not: session.id }, lastSeenAt: { lt: new Date(now.getTime() - IDLE_MS) } },
  });
  const surplus = await prisma.authSession.findMany({
    where: { userId, id: { not: session.id } },
    orderBy: { lastSeenAt: "desc" },
    skip: MAX_SESSIONS - 1,
    select: { id: true },
  });
  if (surplus.length) await prisma.authSession.deleteMany({ where: { userId, id: { in: surplus.map((s) => s.id) } } });
  return session.id;
}

/** True only while this account's own row exists. Anything else, a token from before this release included, is false. */
export async function isSessionValid(claim: { userId: unknown; sessionId: unknown }, now: Date = new Date()): Promise<boolean> {
  const { userId, sessionId } = claim;
  if (typeof userId !== "string" || typeof sessionId !== "string" || !userId || !sessionId) return false;
  const row = await prisma.authSession.findFirst({ where: { id: sessionId, userId }, select: { lastSeenAt: true } });
  if (!row) return false;
  if (now.getTime() - row.lastSeenAt.getTime() >= TOUCH_EVERY_MS) {
    await prisma.authSession.updateMany({ where: { id: sessionId, userId }, data: { lastSeenAt: now } });
  }
  return true;
}

export async function listSessions(userId: string, currentId: string | null) {
  const rows = await prisma.authSession.findMany({
    where: { userId },
    orderBy: { lastSeenAt: "desc" },
    take: MAX_SESSIONS,
    select: { id: true, device: true, createdAt: true, lastSeenAt: true },
  });
  return rows.map((row) => ({ ...row, current: row.id === currentId }));
}

/** Ends one of the account's other sessions. This device's own is ended by signing out. */
export async function revokeSession(userId: string, sessionId: string, currentId: string | null): Promise<void> {
  if (sessionId === currentId) throw new AppError("VALIDATION_ERROR", "Use Sign out to end this device's session.");
  const { count } = await prisma.authSession.deleteMany({ where: { id: sessionId, userId } });
  if (count === 0) throw new AppError("RESOURCE_NOT_FOUND", "That session does not exist.");
}

/** This device signing out: its own row, scoped to the account. A missing row is fine (already ended). */
export async function endSession(userId: string, sessionId: string): Promise<void> {
  await prisma.authSession.deleteMany({ where: { id: sessionId, userId } });
}

export async function revokeOtherSessions(userId: string, currentId: string): Promise<number> {
  return (await prisma.authSession.deleteMany({ where: { userId, id: { not: currentId } } })).count;
}

export async function revokeAllSessions(userId: string): Promise<number> {
  return (await prisma.authSession.deleteMany({ where: { userId } })).count;
}
