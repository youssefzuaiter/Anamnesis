import "server-only";
import { randomBytes } from "node:crypto";
import { AppError } from "@/lib/api-response";
import type { Publish } from "@/lib/ntfy";
import { DEFAULT_PREFS, DIGEST_HOURS, LEAD_CHOICES, planReminders, type PushPrefs } from "@/lib/reminder-schedule";
import * as reminderRepository from "@/repositories/reminder-repository";

/*
 * Reminders sent to a phone while no tab is open. The scheduler (services/reminder-scheduler.ts) calls
 * `runReminderTick` once a minute; everything that decides what is sent, and that it is sent once, is
 * here and in the repository's claim. The transport is passed in, so this file never sees a token.
 */

const RETENTION_MS = 30 * 86_400_000;

export type PushSettings = { enabled: boolean; prefs: PushPrefs; topic: string | null; lastError: string | null };

export async function getPushSettings(userId: string): Promise<PushSettings> {
  const [profile, lastError] = await Promise.all([
    reminderRepository.getPushProfile(userId),
    reminderRepository.lastFailure(userId),
  ]);
  return {
    enabled: profile?.enabled ?? false,
    prefs: profile?.prefs ?? DEFAULT_PREFS,
    topic: profile?.topic ?? null,
    lastError,
  };
}

/** `anamnesis-` and 24 base32 characters (120 random bits): made by the server, never by the browser. */
function newTopic(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const bytes = randomBytes(15);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return `anamnesis-${out}`;
}

export async function setPushSettings(
  userId: string,
  input: { enabled: boolean; leadMinutes: number; digestHour: number; showTitles: boolean },
): Promise<PushSettings> {
  const leadOk = (LEAD_CHOICES as readonly number[]).includes(input.leadMinutes);
  const hourOk = (DIGEST_HOURS as readonly number[]).includes(input.digestHour);
  if (!leadOk || !hourOk) throw new AppError("VALIDATION_ERROR", "That reminder time is not one of the choices.");

  await reminderRepository.savePushProfile(userId, {
    pushEnabled: input.enabled,
    pushLeadMinutes: input.leadMinutes,
    pushDigestHour: input.digestHour,
    pushShowTitles: input.showTitles,
  });
  if (input.enabled) await reminderRepository.setTopicIfMissing(userId, newTopic());
  return getPushSettings(userId);
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The reminder could not be sent.";
}

/**
 * One pass: for every account with push on, what is due now, each reminder claimed before it is sent so
 * it goes once whatever else is ticking. A failed send is recorded and retried by a later tick. One
 * account's trouble never stops another's reminders, and the pass itself never throws for a failed send.
 */
export async function runReminderTick(now: Date, publish: Publish): Promise<{ sent: number; failed: number }> {
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  let sent = 0;
  let failed = 0;
  for (const account of await reminderRepository.listPushAccounts()) {
    try {
      const horizon = new Date(now.getTime() + account.prefs.leadMinutes * 60_000);
      const [dueToday, starting] = await Promise.all([
        reminderRepository.listDueToday(account.userId, endOfDay),
        reminderRepository.listStarting(account.userId, now, horizon),
      ]);
      for (const planned of planReminders({ now, prefs: account.prefs, dueToday, starting })) {
        const claim = await reminderRepository.claimDelivery(account.userId, planned.key);
        if (!claim) continue;
        try {
          await publish({ topic: account.topic, title: planned.title, body: planned.body });
          await reminderRepository.markSent(claim.id, now);
          sent++;
        } catch (error) {
          await reminderRepository.markFailed(claim.id, safeMessage(error));
          failed++;
        }
      }
    } catch (error) {
      failed++;
      console.error("[reminders] an account's reminders failed:", safeMessage(error));
    }
  }
  await reminderRepository.pruneDeliveries(new Date(now.getTime() - RETENTION_MS));
  return { sent, failed };
}

export async function sendTestNotification(userId: string, publish: Publish): Promise<void> {
  const settings = await getPushSettings(userId);
  if (!settings.enabled || !settings.topic) {
    throw new AppError("VALIDATION_ERROR", "Turn on reminders to your phone first.");
  }
  await publish({ topic: settings.topic, title: "Anamnesis", body: "Reminders reach this device." });
}
