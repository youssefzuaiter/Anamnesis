// Calendar sync, the free way first (ROADMAP item 54): what the app can say about a calendar link without asking the provider for anything.
// Pure. A calendar's secret address is a bearer secret (whoever has it can read the calendar), so only its host is ever shown or stored in words.

import { AppError } from "@/lib/api-response";

/** The scheduled sync re-reads a calendar when it was last tried at least this long ago. */
export const SYNC_INTERVAL_MINUTES = 30;
export const SYNC_INTERVAL_MS = SYNC_INTERVAL_MINUTES * 60_000;

export type ProviderId = "google" | "outlook" | "apple" | "other";
export type CalendarProvider = { id: ProviderId; label: string };

const PROVIDERS: { id: Exclude<ProviderId, "other">; label: string; hosts: string[] }[] = [
  { id: "google", label: "Google Calendar", hosts: ["calendar.google.com"] },
  { id: "outlook", label: "Outlook or Teams calendar", hosts: ["outlook.office365.com", "outlook.live.com", "outlook.office.com"] },
  { id: "apple", label: "iCloud calendar", hosts: ["icloud.com"] },
];

/** The lower-case host of a link (`webcal:` included), or null if it is not a link. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** The provider a link belongs to, by its host: a host is a match only if it is that name or a subdomain of it, never a look-alike. */
export function providerOf(url: string): CalendarProvider {
  const host = hostOf(url);
  if (host) {
    for (const p of PROVIDERS) {
      if (p.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return { id: p.id, label: p.label };
    }
  }
  return { id: "other", label: "Calendar link" };
}

/** What to show in place of a link: its host and an ellipsis, since the path and query hold the secret. */
export function maskedAddress(url: string): string {
  const host = hostOf(url);
  return host ? `${host}/…` : "a calendar link";
}

export function isDue(lastAttemptAt: Date | null, now: Date, intervalMs: number = SYNC_INTERVAL_MS): boolean {
  if (lastAttemptAt === null) return true;
  const since = now.getTime() - lastAttemptAt.getTime();
  return since >= intervalMs;
}

/** Why a sync failed, in words that can be stored and shown: an `AppError`'s own message with any address taken out, else a plain sentence. */
export function safeSyncError(error: unknown): string {
  if (!(error instanceof AppError)) return "The sync failed.";
  return error.message.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[address]").slice(0, 200);
}

export const PROVIDER_STEPS: Record<ProviderId, { title: string; steps: string[]; note?: string }> = {
  google: {
    title: "Google Calendar",
    steps: [
      "Open Google Calendar on a computer and click the gear, then Settings.",
      "Under “Settings for my calendars”, choose the calendar.",
      "Scroll to “Integrate calendar” and copy the “Secret address in iCal format”.",
    ],
    note: "Anyone with this address can read the calendar. “Reset” in the same place makes a new one if it ever leaks.",
  },
  outlook: {
    title: "Outlook or Teams",
    steps: [
      "Open Outlook on the web, then Settings, Calendar, Shared calendars.",
      "Under “Publish a calendar”, choose the calendar and “Can view all details”, then Publish.",
      "Copy the ICS link it shows (not the HTML one).",
    ],
    note: "A school or university Microsoft 365 account often has publishing turned off by its administrator. If the option is missing, that is why: use the timetable link your university gives you, or ask them.",
  },
  apple: {
    title: "iCloud calendar",
    steps: [
      "In Calendar on a Mac or at icloud.com, share the calendar and turn on “Public Calendar”.",
      "Copy the link it shows (it starts with webcal://).",
    ],
  },
  other: {
    title: "Another calendar or a university timetable",
    steps: [
      "Look for “Subscribe”, “Export” or “iCal” on the timetable page.",
      "Copy the link that ends in .ics (a webcal:// link works too).",
    ],
  },
};
