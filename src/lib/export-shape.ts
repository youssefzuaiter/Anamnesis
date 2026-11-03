// What the JSON export promises. Pure data and one pure function: no Prisma, no React, so the
// promises can be checked against the schema and the payload without a database in the way
// (`tests/integration/export.test.ts` does exactly that). Adding a model, or a column worth
// leaving out, without touching this file fails that test.

/** Version 1 was the export before this field existed. */
export const EXPORT_FORMAT_VERSION = 2;

/** Prisma model name to the key it has in the file, for every model with a `userId` that is exported. */
export const EXPORTED_MODELS: Readonly<Record<string, string>> = {
  UserProfile: "profile",
  Project: "projects",
  Goal: "goals",
  Note: "notes",
  Task: "tasks",
  Event: "events",
  EntityLink: "links",
  FocusTelemetry: "focusTelemetry",
  AuditEvent: "auditEvents",
  Course: "courses",
  Assessment: "assessments",
  Flashcard: "flashcards",
  NoteVersion: "noteVersions",
  Conversation: "conversations",
  Message: "messages",
  Attachment: "attachments",
  CalendarSubscription: "calendarSubscriptions",
};

/** Models with a `userId` that are deliberately not in the file, and why. */
export const NOT_EXPORTED: Readonly<Record<string, string>> = {
  WorkspaceEmbedding:
    "Derived from the exported text and rebuilt on request (Settings, Rebuild search index); its vector column cannot be written as JSON.",
};

/** Columns of an exported model that are deliberately left out, and why. */
export const OMITTED_COLUMNS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  User: {
    passwordHash: "A credential: it never leaves the database, in an export or anywhere else.",
  },
  CalendarSubscription: {
    url: "A feed address is a bearer secret (anyone holding it can read the timetable); only its host is exported, as `host`.",
  },
};

/** The same omissions in plain words, carried inside the file as `notIncluded` so it explains itself. */
export const NOT_INCLUDED: Readonly<Record<string, string>> = {
  attachmentFiles:
    "The files attached to notes are not in this file, only their records (name, type, size). The files themselves are in the backup's attachments archive.",
  calendarFeedUrls:
    "A calendar feed's address is a secret that lets anyone read your timetable, so only its host name is exported. The events it imported are in `events`.",
  searchIndex:
    "The search index is derived from your text and is rebuilt on request (Settings, Rebuild search index).",
  deletedItems:
    "Items in the trash, and everything that belongs to them, are not exported. Restore them from the trash first if you want them in a file.",
  signInPassword: "Your sign-in password is never exported, and neither is the scrambled form it is stored in.",
};

/**
 * One page of a table: `take` rows after `after`, the ordering value and id of the last row of the page
 * before (null for the first page).
 */
export type ExportPage = { take: number; after: { at: Date; id: string } | null };

/**
 * The rows after `after` in (ordering column, id) order, as a comparison of values. This is deliberately
 * not a Prisma `cursor`, which is the last row itself looked up again for each page: if that row is
 * deleted while the download runs, the next page is empty, and an empty page reads as the end of the
 * table. A value comparison needs no row to still exist. Prisma's `DateTime` is `timestamp(3)`, so a
 * JavaScript `Date` compares exactly.
 */
export function afterCreated(after: ExportPage["after"]) {
  return after ? { OR: [{ createdAt: { gt: after.at } }, { createdAt: after.at, id: { gt: after.id } }] } : {};
}

/** The same for the one table ordered by `recordedAt`. */
export function afterRecorded(after: ExportPage["after"]) {
  return after ? { OR: [{ recordedAt: { gt: after.at } }, { recordedAt: after.at, id: { gt: after.id } }] } : {};
}

/**
 * The host of a feed address and nothing else: no scheme, no `user:password@`, no port, no path,
 * query or fragment, which is where a feed keeps its secret. Null when there is no readable host.
 * A secret placed in the host name itself would still show; that is accepted and documented.
 */
export function feedHost(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "" ? null : host;
  } catch {
    return null;
  }
}
