import "server-only";
import { AppError } from "@/lib/api-response";
import { putAttachment, deleteAttachment } from "@/lib/attachment-store";
import { MAX_NOTE_LENGTH } from "@/lib/see-also";
import { VAULT } from "@/lib/vault";
import { ZIP_LIMITS, ZipError, openZip, type ZipEntry } from "@/lib/zip";
import { classifyEntry, planImport, vaultRoot, cleanTitle, type ParsedNote } from "@/lib/vault-import";
import {
  DATABASE_CHOICES,
  LAYOUT_PROBLEM,
  analyseLayout,
  convertPage,
  databaseCode,
  type DatabaseChoice,
} from "@/lib/notion";
import * as noteService from "@/services/note-service";
import * as projectService from "@/services/project-service";
import * as courseService from "@/services/course-service";
import * as attachmentRepository from "@/repositories/attachment-repository";
import * as courseRepository from "@/repositories/course-repository";
import * as noteRepository from "@/repositories/note-repository";
import * as projectRepository from "@/repositories/project-repository";
import { assertUserId } from "@/services/export-service";
import { label, readAttachment, uniqueIds } from "@/services/vault-service";

/*
 * Importing a Notion "Markdown & CSV" export (ROADMAP item 37). The zip is hostile data: nothing in it is an id, an owner or a
 * path that is used. Pages are written through `noteService.createNote` as the session's user, files through `putAttachment`
 * under a generated key, and a database becomes a project or a course by NAME among the account's own (made when it is missing,
 * only when a row of it will be created). Preview and apply are one function: apply only adds the writes.
 *
 * Identity is the vault importer's rule (same title and same text is already there; a different note under a title the account
 * uses comes in as "Title (imported)"), so importing the same export twice adds nothing. Links are rewritten to the pages'
 * ORIGINAL titles for that reason: the text a second run builds is the text the first one stored.
 */

const REPORT_LIST_CAP = 100;
const MAX_PAGE_BYTES = VAULT.maxMdBytes;
const MAX_DATABASE_CHOICES = 200;
const MAX_ATTACHMENTS_PER_NOTE = VAULT.maxAttachmentsPerNote;
const COURSE_TERM = "Notion import";

export type NotionDatabaseReport = {
  id: string;
  name: string;
  rows: number;
  choice: DatabaseChoice;
  /** What a restore would use: an existing project or course by that name, one it makes, or none. */
  target: "existing" | "new" | "none" | "ambiguous";
};

export type NotionImportReport = {
  apply: boolean;
  notes: {
    /** Pages read from the zip. */
    found: number;
    create: number;
    created: number;
    /** Already in the account: same title and same text. */
    present: number;
    renamed: { from: string; to: string }[];
    deferred: number;
    failed: number;
  };
  databases: NotionDatabaseReport[];
  links: { converted: number; unresolved: number };
  attachments: { found: number; stored: number; rejected: { name: string; reason: string }[]; rejectedTotal: number };
  skipped: { path: string; reason: string }[];
  skippedTotal: number;
  ignored: number;
  /** Projects and courses this run made (a preview: would make). */
  made: { projects: string[]; courses: string[] };
};

const zipRefusal = (error: unknown): unknown =>
  error instanceof ZipError ? new AppError("VALIDATION_ERROR", `${error.message} Choose the zip Notion made when you exported with Format “Markdown & CSV”.`) : error;

/** The choices a request names, by database id; anything else is ignored. */
export function parseChoices(raw: readonly string[]): Map<string, DatabaseChoice> {
  const out = new Map<string, DatabaseChoice>();
  for (const item of raw.slice(0, MAX_DATABASE_CHOICES)) {
    const match = /^([0-9a-f]{32}):([a-z]{4,7})$/i.exec(item);
    if (!match) continue;
    const choice = match[2].toLowerCase();
    if ((DATABASE_CHOICES as readonly string[]).includes(choice)) out.set(match[1].toLowerCase(), choice as DatabaseChoice);
  }
  return out;
}

type Place = { kind: "project"; name: string } | { kind: "course"; name: string; title: string };

export async function runNotionImport(
  userId: string,
  bytes: Uint8Array,
  options: { apply: boolean; choices?: Map<string, DatabaseChoice>; limit?: number; byteBudget?: number },
): Promise<NotionImportReport> {
  assertUserId(userId);
  let zip: ReturnType<typeof openZip>;
  try {
    zip = openZip(bytes);
  } catch (error) {
    throw zipRefusal(error);
  }

  const report: NotionImportReport = {
    apply: options.apply,
    notes: { found: 0, create: 0, created: 0, present: 0, renamed: [], deferred: 0, failed: 0 },
    databases: [],
    links: { converted: 0, unresolved: 0 },
    attachments: { found: 0, stored: 0, rejected: [], rejectedTotal: 0 },
    skipped: [],
    skippedTotal: 0,
    ignored: 0,
    made: { projects: [], courses: [] },
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
  const root = vaultRoot(zip.entries.map((entry) => entry.name));
  const byPath = new Map<string, ZipEntry>();
  for (const entry of zip.entries) {
    const name = entry.name.startsWith(root) ? entry.name.slice(root.length) : entry.name;
    const kind = classifyEntry(name);
    if (kind.kind === "unsafe") {
      skip(entry.name, "Its path is not one a Notion export uses.");
      continue;
    }
    if (entry.directory) continue;
    if (kind.kind === "ignored" && ["a folder", "macOS or Windows metadata", "a hidden folder or file"].includes(kind.reason)) {
      report.ignored += 1;
      continue;
    }
    const path = name.replaceAll("\\", "/");
    if (byPath.has(path)) {
      skip(entry.name, "Its name is used twice in the zip; the first one is used.");
      continue;
    }
    if (entry.symlink) {
      skip(entry.name, "It is a link, not a file.");
      continue;
    }
    byPath.set(path, entry);
  }

  const layout = analyseLayout([...byPath.keys()]);
  if (layout.problem !== null) throw new AppError("VALIDATION_ERROR", LAYOUT_PROBLEM[layout.problem]);

  // Read every page once. A page that cannot be used is counted and left out; it is never a reason to stop.
  const texts = new Map<string, string>();
  for (const page of layout.pages) {
    const entry = byPath.get(page.path)!;
    if (entry.unsupported !== null) {
      skip(page.path, entry.unsupported);
      continue;
    }
    if (entry.size > MAX_PAGE_BYTES) {
      skip(page.path, `It is too large for a note (over ${MAX_PAGE_BYTES / 1024} KB).`);
      continue;
    }
    try {
      texts.set(page.path, (await zip.read(entry)).toString("utf8"));
    } catch (error) {
      if (error instanceof ZipError) {
        skip(page.path, "It could not be read from the zip.");
        continue;
      }
      throw error;
    }
  }

  // Titles first (a page's own `# Heading`), so a link can name the page it points at; then each page again with links.
  const titleByPath = new Map<string, string>();
  const titleById = new Map<string, string>();
  const noLinks = { path: "", titleByPath: () => null, titleById: () => null, fileAt: () => null };
  for (const page of layout.pages) {
    const raw = texts.get(page.path);
    if (raw === undefined) continue;
    const { title } = convertPage(raw, page.title, { ...noLinks, path: page.path });
    titleByPath.set(page.path, title);
    if (page.id !== null && !titleById.has(page.id)) titleById.set(page.id, title);
  }
  const fileSet = new Set(layout.files.filter((path) => {
    const entry = byPath.get(path);
    return entry !== undefined && entry.unsupported === null && !path.toLowerCase().endsWith(".zip");
  }));
  const context = (path: string) => ({
    path,
    titleByPath: (target: string) => titleByPath.get(target) ?? null,
    titleById: (id: string) => titleById.get(id) ?? null,
    fileAt: (target: string) => (fileSet.has(target) ? target : null),
  });

  // Databases: what each becomes is the person's choice (a project unless they say otherwise).
  const choices = options.choices ?? new Map<string, DatabaseChoice>();
  const [courses, projects] = await Promise.all([courseRepository.listCourseOptions(userId), projectRepository.listProjectOptions(userId)]);
  const courseIds = uniqueIds(courses.map((course) => ({ id: course.id, key: course.code })));
  const projectIds = uniqueIds(projects.map((project) => ({ id: project.id, key: project.title })));
  const placeOf = new Map<string, Place>();
  for (const db of layout.databases) {
    const choice = choices.get(db.id) ?? "project";
    let target: NotionDatabaseReport["target"] = "none";
    if (choice === "project") {
      const name = cleanTitle(db.name) || "Notion";
      placeOf.set(db.id, { kind: "project", name });
      const found = projectIds.get(name.toLowerCase());
      target = found === undefined ? "new" : found === null ? "ambiguous" : "existing";
    } else if (choice === "course") {
      const code = databaseCode(db.name);
      placeOf.set(db.id, { kind: "course", name: code, title: cleanTitle(db.name).slice(0, 160) || code });
      const found = courseIds.get(code.toLowerCase());
      target = found === undefined ? "new" : found === null ? "ambiguous" : "existing";
    }
    report.databases.push({ id: db.id, name: label(db.name), rows: db.rows, choice, target });
  }

  // The notes, with links and the files each uses.
  const parsed: ParsedNote[] = [];
  const attachmentsOf = new Map<string, string[]>();
  const databaseOf = new Map<string, string | null>();
  for (const page of layout.pages) {
    const raw = texts.get(page.path);
    if (raw === undefined) continue;
    const converted = convertPage(raw, page.title, context(page.path));
    if (converted.content.length > MAX_NOTE_LENGTH) {
      skip(page.path, `It is longer than a note can be (${MAX_NOTE_LENGTH.toLocaleString("en-US")} characters).`);
      continue;
    }
    report.links.converted += converted.linksConverted;
    report.links.unresolved += converted.linksUnresolved;
    parsed.push({
      path: page.path,
      title: converted.title,
      content: converted.content,
      tags: ["imported", "notion"],
      favorite: false,
      course: null,
      project: null,
      attachments: [],
      ours: false,
      droppedProperties: [],
    });
    attachmentsOf.set(page.path, converted.attachments.slice(0, MAX_ATTACHMENTS_PER_NOTE));
    if (converted.attachments.length > MAX_ATTACHMENTS_PER_NOTE) {
      reject(`${page.path} (${converted.attachments.length - MAX_ATTACHMENTS_PER_NOTE} more)`, `A note keeps at most ${MAX_ATTACHMENTS_PER_NOTE} files.`);
    }
    databaseOf.set(page.path, page.database);
  }
  report.notes.found = parsed.length;
  report.attachments.found = fileSet.size;

  const existing = await noteRepository.listImportIdentities(userId);
  const plan = planImport(existing, parsed, options.limit ?? VAULT.maxImportNotes);

  // As the vault import does: what one run reads for attachments is held to the zip limit, and a note that would pass it waits.
  const byteBudget = options.byteBudget ?? ZIP_LIMITS.maxTotalBytes;
  let spent = 0;
  const creating: typeof plan.create = [];
  let overBudget = 0;
  for (const note of plan.create) {
    let needs = 0;
    for (const path of attachmentsOf.get(note.path) ?? []) needs += byPath.get(path)?.size ?? 0;
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

  // Make the projects and courses a row of which will be created, once each, by name.
  const needed = new Set<string>();
  for (const note of creating) {
    const db = databaseOf.get(note.path);
    if (db) needed.add(db);
  }
  const resolvedPlace = new Map<string, { projectId: string | null; courseId: string | null }>();
  for (const [dbId, place] of placeOf) {
    if (!needed.has(dbId)) continue;
    if (place.kind === "project") {
      const found = projectIds.get(place.name.toLowerCase());
      if (found) resolvedPlace.set(dbId, { projectId: found, courseId: null });
      else if (found === undefined) {
        report.made.projects.push(label(place.name));
        if (options.apply) {
          const made = await projectService.createProject(userId, { title: place.name, category: "Personal", goalId: null });
          projectIds.set(place.name.toLowerCase(), made.id);
          resolvedPlace.set(dbId, { projectId: made.id, courseId: null });
        }
      }
    } else {
      const found = courseIds.get(place.name.toLowerCase());
      if (found) resolvedPlace.set(dbId, { projectId: null, courseId: found });
      else if (found === undefined) {
        report.made.courses.push(label(place.name));
        if (options.apply) {
          const made = await courseRepository.createCourse(userId, { code: place.name, title: place.title, term: COURSE_TERM });
          await courseService.indexCourse(userId, made.id);
          courseIds.set(place.name.toLowerCase(), made.id);
          resolvedPlace.set(dbId, { projectId: null, courseId: made.id });
        }
      }
    }
  }

  for (const note of creating) {
    const place = resolvedPlace.get(databaseOf.get(note.path) ?? "") ?? { projectId: null, courseId: null };
    let noteId: string | null = null;
    if (options.apply) {
      try {
        const created = await noteService.createNote(userId, {
          title: note.finalTitle,
          content: note.content,
          tags: note.tags,
          isFavorite: false,
          projectId: place.projectId,
          courseId: place.courseId,
        });
        noteId = created.id;
        report.notes.created += 1;
      } catch (error) {
        console.error("[WARN] Notion import: a note could not be saved:", error);
        report.notes.failed += 1;
        skip(note.path, "It could not be saved.");
        continue;
      }
    }
    for (const path of attachmentsOf.get(note.path) ?? []) {
      const entry = byPath.get(path);
      if (!entry) {
        reject(path, "It is not in the zip.");
        continue;
      }
      const checked = await readAttachment(zip, entry);
      if (!checked.ok) {
        reject(path, checked.reason);
        continue;
      }
      if (!options.apply || noteId === null) {
        report.attachments.stored += 1;
        continue;
      }
      let key: string | null = null;
      try {
        key = await putAttachment(checked.data, checked.mime);
        await attachmentRepository.createAttachment(userId, {
          noteId,
          filename: checked.fileName.replace(/\p{Cc}/gu, " ").slice(0, 200),
          mimeType: checked.mime,
          byteSize: checked.data.length,
          storageKey: key,
        });
        report.attachments.stored += 1;
      } catch (error) {
        console.error("[WARN] Notion import: an attachment could not be saved:", error);
        if (key !== null) await deleteAttachment(key);
        reject(path, "It could not be saved.");
      }
    }
  }
  return report;
}
