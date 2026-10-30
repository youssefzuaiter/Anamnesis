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
