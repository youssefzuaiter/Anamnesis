import "server-only";
import { AppError } from "@/lib/api-response";
import { MAX_ATTACHMENT_BYTES } from "@/lib/attachment-types";
import { deleteAttachment, getAttachment, putAttachment } from "@/lib/attachment-store";
import { ZIP_LIMITS, ZipError, ZipWriter, openZip, type ZipEntry } from "@/lib/zip";
import { VAULT, allocateNames, attachmentParts, manifestJson, noteFile, safeStem, type NameInput } from "@/lib/vault";
import { baseName, classifyEntry, parseNoteFile, planImport, sniffAttachment, vaultRoot, type ParsedNote } from "@/lib/vault-import";
import type { NoteInput } from "@/repositories/note-repository";
import * as noteService from "@/services/note-service";
import * as attachmentRepository from "@/repositories/attachment-repository";
import * as courseRepository from "@/repositories/course-repository";
import * as noteRepository from "@/repositories/note-repository";
import * as projectRepository from "@/repositories/project-repository";
import { assertUserId, pagesOf, tables } from "@/services/export-service";

/**
 * A Markdown vault: one `.md` file per live note, named by its title so `[[Title]]` works in
 * Obsidian, with its attachments in `attachments/` and a manifest in `.anamnesis/`. What it holds
 * and what it leaves out is written in `lib/vault.ts` and in the manifest itself. Restoring from
 * one is `runVaultImport`, below.
 *
 * - Every query carries `userId`; trashed notes and the attachments of trashed notes are left out.
 * - Nothing in the zip is an id or an owner.
 * - It is written one entry at a time: a note's page of 50 is read, each attachment is read and
 *   written alone, and only the directory records are kept, so memory is one attachment plus the
 *   names. It is not a snapshot: a note created while it runs is not in it.
 */

/** What one zip can honestly hold (zip32: 65,535 entries and 4 GiB), with room to spare for the note text. */
const PREFLIGHT = { maxEntries: 60_000, maxBytes: 3_500_000_000 };

const TOO_LARGE =
  "This is too large for one zip (it holds more than a zip can). Use the JSON export or the backup for everything, or move some attachments out first.";

/**
 * Refuses, before the first byte, an account whose vault could not fit in one zip: more entries
 * than the format allows, or attachments that alone come near its 4 GiB. The writer refuses too
 * if the note text pushes it over; this is the early, cheap answer for the common case.
 */
export async function vaultPreflight(userId: string, limits: { maxEntries: number; maxBytes: number } = PREFLIGHT): Promise<void> {
  assertUserId(userId);
  const [notes, attachments] = await Promise.all([noteRepository.countNotes(userId), attachmentRepository.vaultTotals(userId)]);
  if (notes + attachments.count + 1 > limits.maxEntries || attachments.bytes > limits.maxBytes) {
    throw new AppError("VALIDATION_ERROR", TOO_LARGE);
  }
}

/** Adds to the list a key holds, making it first: no copy of the whole list for each addition. */
function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Already-compressed types are stored; text is deflated. */
const isText = (mime: string) => mime.startsWith("text/");

async function* writeVault(userId: string, options: { maxOffset?: number }): AsyncGenerator<Buffer> {
  assertUserId(userId);

  const [identities, attachments, courses, projects] = await Promise.all([
    noteRepository.listVaultIdentities(userId),
    attachmentRepository.listForVault(userId),
    courseRepository.listCourseOptions(userId),
    projectRepository.listProjectOptions(userId),
  ]);

  // Every name is chosen before any file is written, so that the note a link would resolve to in
  // the app keeps the plain name and a number never lands on a real note's name.
  const items: NameInput[] = identities.map((note) => ({ id: `n:${note.id}`, stem: safeStem(note.title), ext: ".md", rank: note.updatedAt }));
  const unsupported = new Map<string, { note: string; name: string }[]>();
  const titleOf = new Map(identities.map((note) => [note.id, note.title]));
  const byNote = new Map<string, typeof attachments>();
  for (const row of attachments) {
    const parts = attachmentParts(row.filename, row.mimeType);
    if (!parts) {
      // A type that may no longer be attached (an old row): left out, and said so.
      append(unsupported, row.noteId, { note: titleOf.get(row.noteId) ?? "", name: row.filename });
      continue;
    }
    items.push({ id: `a:${row.id}`, stem: parts.stem, ext: parts.ext, rank: row.createdAt });
    append(byNote, row.noteId, row);
  }
  const names = allocateNames(items);
  const courseCode = new Map(courses.map((course) => [course.id, course.code]));
  const projectTitle = new Map(projects.map((project) => [project.id, project.title]));

  const writer = new ZipWriter({ maxOffset: options.maxOffset });
  const missing = [...unsupported.values()].flat();
  let noteCount = 0;
  let attachmentCount = 0;

  for await (const page of pagesOf(tables.notes, userId, tables.notes.size)) {
    for (const note of page) {
      const fileName = names.get(`n:${note.id}`);
      if (!fileName) continue; // created after the names were chosen: not in this vault

      // Attachments first, one at a time, so the note can list exactly those that were written.
      const linked: string[] = [];
      for (const row of byNote.get(note.id) ?? []) {
        const name = names.get(`a:${row.id}`) as string;
        let bytes: Buffer;
        try {
          bytes = await getAttachment(row.storageKey);
        } catch {
          // The row survived but the file did not.
          console.error(`[WARN] vault: the file of attachment ${row.id} is missing from the disk`);
          missing.push({ note: note.title, name });
          continue;
        }
        yield await writer.add({ name: `${VAULT.attachmentsDir}/${name}`, data: bytes, modified: row.createdAt, store: !isText(row.mimeType) });
        linked.push(name);
        attachmentCount += 1;
      }

      const text = noteFile(note, {
        course: note.courseId ? (courseCode.get(note.courseId) ?? null) : null,
        project: note.projectId ? (projectTitle.get(note.projectId) ?? null) : null,
        attachments: linked,
      });
      yield await writer.add({ name: fileName, data: Buffer.from(text, "utf8"), modified: note.updatedAt });
      noteCount += 1;
    }
  }

  const info = manifestJson({ exportedAt: new Date(), notes: noteCount, attachments: attachmentCount, missing });
  yield await writer.add({ name: VAULT.manifestPath, data: Buffer.from(info, "utf8"), modified: new Date() });
  yield writer.finish();
}

/**
 * The vault as chunks of a zip, entry by entry. A zip that cannot hold what is in it (a limit of
 * the format) fails with a plain `VALIDATION_ERROR`, and a stream that stopped there has no end
 * record, so it never opens as a smaller, whole-looking vault.
 */
export async function* streamVault(userId: string, options: { maxOffset?: number } = {}): AsyncGenerator<Buffer> {
  try {
    yield* writeVault(userId, options);
  } catch (error) {
    if (error instanceof ZipError && error.code === "too-large") throw new AppError("VALIDATION_ERROR", TOO_LARGE);
    throw error;
  }
}

// --- Restoring ----------------------------------------------------------------------------------
//
// The zip is hostile data (a file the person picked from anywhere). Nothing in it is an id, an
// owner or a path that is used: notes are written through `noteService.createNote` as the caller,
// files through `putAttachment` under a generated key, the course and project are found by name
// among the caller's own, and everything that is "already here" is judged from the caller's own
// notes. The preview and the apply are one function, so the preview is what apply does.

const REPORT_LIST_CAP = 100;

export type VaultImportReport = {
  apply: boolean;
  notes: {
    /** Notes read from the zip. */
    found: number;
    /** Notes this run would create (a preview) or tried to (an apply). */
    create: number;
    created: number;
    /** Already in the account: same title and same text. */
    present: number;
    /** Created under another title because the account already has a different note by that title. */
    renamed: { from: string; to: string }[];
    /** Beyond this run's limit: run the import again. */
    deferred: number;
    failed: number;
    withoutCourse: number;
    withoutProject: number;
  };
  attachments: {
    /** Files under `attachments/`. */
    found: number;
    /** Stored (or, in a preview, would be). */
    stored: number;
    rejected: { name: string; reason: string }[];
    rejectedTotal: number;
    /** Files no note in the zip lists. */
    unreferenced: number;
  };
  /** The first 100; `skippedTotal` is all of them. */
  skipped: { path: string; reason: string }[];
  skippedTotal: number;
  /** Files that are not notes or attachments (folders are not counted). */
  ignored: number;
  /** Notes that had properties this app has no place for. */
  droppedProperties: number;
};

/** A name from the zip as text for a report: no control characters, at most 200 characters. */
const label = (name: string) => name.replace(/\p{Cc}/gu, "?").slice(0, 200);

const zipRefusal = (error: unknown): unknown =>
  error instanceof ZipError ? new AppError("VALIDATION_ERROR", `${error.message} Choose a vault zip made by Anamnesis or by Obsidian.`) : error;

/** Id by lower-cased name; a name used twice maps to null, so it matches nothing rather than the wrong one. */
function uniqueIds(items: { id: string; key: string }[]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const { id, key } of items) {
    const name = key.trim().toLowerCase();
    if (name !== "") map.set(name, map.has(name) ? null : id);
  }
  return map;
}

/**
 * One attachment out of the zip, or why it cannot be used: unsupported (too large, encrypted),
 * unreadable (a lying size or checksum), or bytes that are not what the file name says.
 */
async function readAttachment(
  zip: ReturnType<typeof openZip>,
  entry: ZipEntry,
): Promise<{ ok: true; data: Buffer; mime: string; fileName: string } | { ok: false; reason: string }> {
  if (entry.unsupported !== null) return { ok: false, reason: entry.unsupported };
  let data: Buffer;
  try {
    data = await zip.read(entry);
  } catch (error) {
    if (error instanceof ZipError) return { ok: false, reason: "It could not be read from the zip." };
    throw error;
  }
  const fileName = baseName(entry.name);
  if (data.length > MAX_ATTACHMENT_BYTES) return { ok: false, reason: "It is too large to attach." };
  const mime = sniffAttachment(fileName, data);
  return mime === null ? { ok: false, reason: "Its content is not what its name says." } : { ok: true, data, mime, fileName };
}

export async function runVaultImport(
  userId: string,
  bytes: Uint8Array,
  options: {
    apply: boolean;
    limit?: number;
    byteBudget?: number;
    /** Seams for tests: the two writes that can fail for reasons outside the file. */
    deps?: { createNote?: (userId: string, input: NoteInput) => Promise<{ id: string }>; putAttachment?: (bytes: Uint8Array, mimeType: string) => Promise<string> };
  },
): Promise<VaultImportReport> {
  assertUserId(userId);
  const createNote = options.deps?.createNote ?? noteService.createNote;
  const store = options.deps?.putAttachment ?? putAttachment;

  let zip: ReturnType<typeof openZip>;
  try {
    zip = openZip(bytes);
  } catch (error) {
    throw zipRefusal(error);
  }

  const report: VaultImportReport = {
    apply: options.apply,
    notes: { found: 0, create: 0, created: 0, present: 0, renamed: [], deferred: 0, failed: 0, withoutCourse: 0, withoutProject: 0 },
    attachments: { found: 0, stored: 0, rejected: [], rejectedTotal: 0, unreferenced: 0 },
    skipped: [],
    skippedTotal: 0,
    ignored: 0,
    droppedProperties: 0,
  };
  const skip = (path: string, reason: string) => {
    report.skippedTotal += 1;
    if (report.skipped.length < REPORT_LIST_CAP) report.skipped.push({ path: label(path), reason });
  };
  const reject = (name: string, reason: string) => {
    report.attachments.rejectedTotal += 1;
    if (report.attachments.rejected.length < REPORT_LIST_CAP) report.attachments.rejected.push({ name: label(name), reason });
  };

  // What each entry is. Names are judged and counted here; none is ever used to reach a file.
  const seen = new Set<string>();
  const noteEntries: ZipEntry[] = [];
  const pool = new Map<string, ZipEntry>();
  const poolLower = new Map<string, ZipEntry>();
  const poolEntries: ZipEntry[] = [];
  // A vault zipped as a folder has everything one level down: judge each name from inside it.
  const root = vaultRoot(zip.entries.map((entry) => entry.name));
  for (const entry of zip.entries) {
    const kind = classifyEntry(entry.name.startsWith(root) ? entry.name.slice(root.length) : entry.name);
    if (kind.kind === "unsafe") {
      skip(entry.name, "Its path is not one a vault uses.");
      continue;
    }
    if (entry.directory) continue;
    if (kind.kind === "ignored") {
      report.ignored += 1;
      continue;
    }
    if (seen.has(entry.name)) {
      skip(entry.name, "Its name is used twice in the zip; the first one is used.");
      continue;
    }
    seen.add(entry.name);
    if (entry.symlink) {
      skip(entry.name, "It is a link, not a file.");
      continue;
    }
    if (kind.kind === "attachment") {
      poolEntries.push(entry);
      const base = baseName(entry.name);
      if (!pool.has(base)) pool.set(base, entry);
      if (!poolLower.has(base.toLowerCase())) poolLower.set(base.toLowerCase(), entry);
    } else if (entry.unsupported !== null) {
      skip(entry.name, entry.unsupported);
    } else if (entry.size > VAULT.maxMdBytes) {
      skip(entry.name, `It is too large for a note (over ${VAULT.maxMdBytes / 1024} KB).`);
    } else {
      noteEntries.push(entry);
    }
  }
  report.attachments.found = poolEntries.length;

  const notes: ParsedNote[] = [];
  for (const entry of noteEntries) {
    let text: string;
    try {
      text = (await zip.read(entry)).toString("utf8");
    } catch (error) {
      if (error instanceof ZipError) {
        skip(entry.name, "It could not be read from the zip.");
        continue;
      }
      throw error;
    }
    const parsed = parseNoteFile(entry.name, text);
    if ("skip" in parsed) skip(entry.name, parsed.skip);
    else notes.push(parsed);
  }
  report.notes.found = notes.length;
  report.droppedProperties = notes.filter((note) => note.droppedProperties.length > 0).length;

  const [existing, courses, projects] = await Promise.all([
    noteRepository.listImportIdentities(userId),
    courseRepository.listCourseOptions(userId),
    projectRepository.listProjectOptions(userId),
  ]);
  const courseIds = uniqueIds(courses.map((course) => ({ id: course.id, key: course.code })));
  const projectIds = uniqueIds(projects.map((project) => ({ id: project.id, key: project.title })));

  const plan = planImport(existing, notes, options.limit ?? VAULT.maxImportNotes);
  const lookup = (name: string) => pool.get(name) ?? poolLower.get(name.toLowerCase());

  // The size limit of a zip is on what it says it holds, but a note that lists a file reads it again:
  // sixty notes listing one 10 MiB file would write 600 MiB from a 21 KB upload. So what one run
  // reads for attachments, each listing counted, is held to the same limit, and a note that would pass
  // it waits for the next run (one note lists at most 20 files, 200 MiB, so a run always makes progress).
  const byteBudget = options.byteBudget ?? ZIP_LIMITS.maxTotalBytes;
  let spent = 0;
  const creating: typeof plan.create = [];
  let overBudget = 0;
  for (const note of plan.create) {
    let needs = 0;
    for (const name of note.attachments) {
      const entry = lookup(name);
      if (entry && entry.unsupported === null) needs += entry.size;
    }
    if (spent + needs > byteBudget) {
      overBudget += 1;
      continue;
    }
    spent += needs;
    creating.push(note);
  }
  report.notes.create = creating.length;
  report.notes.present = plan.present.length;
  report.notes.deferred = plan.deferred.length + overBudget;
  report.notes.renamed = creating.filter((note) => note.renamed).map((note) => ({ from: label(note.title), to: label(note.finalTitle) }));
  const referenced = new Set<ZipEntry>();
  for (const note of notes) for (const name of note.attachments) {
    const entry = lookup(name);
    if (entry) referenced.add(entry);
  }
  report.attachments.unreferenced = poolEntries.length - referenced.size;

  for (const note of creating) {
    const courseId = note.course === null ? null : (courseIds.get(note.course.trim().toLowerCase()) ?? null);
    const projectId = note.project === null ? null : (projectIds.get(note.project.trim().toLowerCase()) ?? null);
    if (note.course !== null && courseId === null) report.notes.withoutCourse += 1;
    if (note.project !== null && projectId === null) report.notes.withoutProject += 1;

    let noteId: string | null = null;
    if (options.apply) {
      try {
        const created = await createNote(userId, {
          title: note.finalTitle,
          content: note.content,
          // Notes from another tool say where they came from; notes this app wrote are restored as they were.
          tags: [...new Set([...(note.ours ? [] : ["imported"]), ...note.tags])].slice(0, 12),
          isFavorite: note.favorite,
          projectId,
          courseId,
        });
        noteId = created.id;
        report.notes.created += 1;
      } catch (error) {
        console.error("[WARN] vault import: a note could not be saved:", error);
        report.notes.failed += 1;
        skip(note.path, "It could not be saved.");
        continue;
      }
    }

    for (const name of note.attachments) {
      const entry = lookup(name);
      if (!entry) {
        reject(name, "It is not in the zip.");
        continue;
      }
      const checked = await readAttachment(zip, entry);
      if (!checked.ok) {
        reject(name, checked.reason);
        continue;
      }
      const { data, mime, fileName } = checked;
      if (!options.apply || noteId === null) {
        report.attachments.stored += 1;
        continue;
      }
      // The stored name is generated; the file's own name is kept only as the label it is shown under.
      let key: string | null = null;
      try {
        key = await store(data, mime);
        await attachmentRepository.createAttachment(userId, {
          noteId,
          filename: fileName.replace(/\p{Cc}/gu, " ").slice(0, 200),
          mimeType: mime,
          byteSize: data.length,
          storageKey: key,
        });
        report.attachments.stored += 1;
      } catch (error) {
        // A full disk or a failed insert: counted like any other failure, the run goes on, and a file
        // that was written before the insert failed does not stay behind.
        console.error("[WARN] vault import: an attachment could not be saved:", error);
        if (key !== null) await deleteAttachment(key);
        reject(name, "It could not be saved.");
      }
    }
  }
  return report;
}
