import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { UserProfileModel as UserProfile } from "@/generated/prisma/models";
import type { GradeScale } from "@/lib/gpa-scale";

export type ProfileInput = {
  university: string;
  program: string;
  studentId: string;
};

/**
 * Accounts created before the profile row existed have none, so this creates
 * the row on first read rather than returning null and pushing the empty case
 * onto every caller.
 */
export async function getProfile(userId: string): Promise<UserProfile> {
  return prisma.userProfile.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function updateProfile(
  userId: string,
  input: ProfileInput,
): Promise<UserProfile> {
  return prisma.userProfile.upsert({
    where: { userId },
    create: { userId, ...input },
    update: input,
  });
}

/** The stored scale is returned as read (JSON), for the caller to validate. */
export async function getGpaSettings(
  userId: string,
): Promise<{ targetGpa: number | null; gpaScale: unknown }> {
  const profile = await getProfile(userId);
  return { targetGpa: profile.targetGpa, gpaScale: profile.gpaScale };
}

export async function setTargetGpa(userId: string, target: number | null): Promise<void> {
  await prisma.userProfile.upsert({
    where: { userId },
    create: { userId, targetGpa: target },
    update: { targetGpa: target },
  });
}

/** A null scale stores database NULL, which means "the preset". */
export async function setGpaScale(userId: string, scale: GradeScale | null): Promise<void> {
  const value = scale === null ? Prisma.DbNull : scale;
  await prisma.userProfile.upsert({
    where: { userId },
    create: { userId, gpaScale: value },
    update: { gpaScale: value },
  });
}

/**
 * Stores (or, with null, clears) the hash of the calendar feed token and when it was made. An upsert,
 * so an account with no profile row yet can make a link. A second call replaces the first: the old
 * address stops working at once.
 */
export async function setFeedHash(userId: string, hash: string | null, now: Date): Promise<void> {
  const data = { calendarFeedHash: hash, calendarFeedCreatedAt: hash === null ? null : now };
  await prisma.userProfile.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

/** Whether the account has a feed link and when it was made. Reads only: it never creates a profile row. */
export async function getFeedStatus(userId: string): Promise<{ active: boolean; createdAt: Date | null }> {
  const row = await prisma.userProfile.findUnique({
    where: { userId },
    select: { calendarFeedHash: true, calendarFeedCreatedAt: true },
  });
  return { active: row?.calendarFeedHash != null, createdAt: row?.calendarFeedCreatedAt ?? null };
}

/**
 * The account a feed token belongs to, by the hash of the token. The one read keyed by something other
 * than a user: everything after it is scoped by the user it returns.
 */
export async function findUserIdByFeedHash(hash: string): Promise<string | null> {
  const row = await prisma.userProfile.findUnique({ where: { calendarFeedHash: hash }, select: { userId: true } });
  return row?.userId ?? null;
}

