import "server-only";
import { AppError } from "@/lib/api-response";
import { getAttachment } from "@/lib/attachment-store";
import { ZipError, ZipWriter } from "@/lib/zip";
import { VAULT, allocateNames, attachmentParts, manifestJson, noteFile, safeStem, type NameInput } from "@/lib/vault";
import * as attachmentRepository from "@/repositories/attachment-repository";
import * as courseRepository from "@/repositories/course-repository";
import * as noteRepository from "@/repositories/note-repository";
import * as projectRepository from "@/repositories/project-repository";
import { assertUserId, pagesOf, tables } from "@/services/export-service";

/**
 * A Markdown vault: one `.md` file per live note, named by its title so `[[Title]]` works in
 * Obsidian, with its attachments in `attachments/` and a manifest in `.anamnesis/`. What it holds
 * and what it leaves out is written in `lib/vault.ts` and in the manifest itself. Restoring from
 * one is the second half of this file.
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
      const list = unsupported.get(row.noteId) ?? [];
      list.push({ note: titleOf.get(row.noteId) ?? "", name: row.filename });
      unsupported.set(row.noteId, list);
      continue;
    }
    items.push({ id: `a:${row.id}`, stem: parts.stem, ext: parts.ext, rank: row.createdAt });
    byNote.set(row.noteId, [...(byNote.get(row.noteId) ?? []), row]);
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
