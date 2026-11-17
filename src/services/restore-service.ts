import "server-only";
import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/api-response";
import {
  IdMap,
  NOT_RESTORED,
  RESTORE_KINDS,
  RESTORE_LIMITS,
  keys,
  normaliseSchedule,
  parseExportFile,
  type RestoreKind,
  type RowProblem,
} from "@/lib/restore";
import { contentHash, family, planImport, type ParsedNote } from "@/lib/vault-import";
import { referenceSchema } from "@/lib/reference-input";
import { goalSchema } from "@/lib/weekly-goals";
import * as weeklyGoalService from "@/services/weekly-goal-service";
import * as repo from "@/repositories/restore-repository";
import * as noteService from "@/services/note-service";
import * as goalService from "@/services/goal-service";
import * as projectService from "@/services/project-service";
import * as courseService from "@/services/course-service";
import * as referenceService from "@/services/reference-service";

/*
 * Restoring from a JSON export (ROADMAP item 35). The file is hostile data (see lib/restore.ts):
 *  - no id from it is stored; every row made here gets a fresh id and the file's ids only link one row to another;
 *  - a link that does not resolve to a row restored or already in THIS account becomes "none", so a row of the
 *    file can never attach to someone else's project, course, goal, assessment or note;
 *  - a row is "already here" by what it is (a title, a date, a text), so restoring twice adds nothing, and an
 *    existing row is never changed or deleted;
 *  - derived values (progress, completion time) are worked out here, not read from the file.
 * The preview and the apply are one function: apply only adds the writes.
 */

export type KindReport = {
  /** Rows in the file for this table. */
  found: number;
  /** Rows this run would create (a preview) or tried to (an apply). */
  create: number;
  created: number;
  /** Already in the account (or an earlier row of this file is the same). */
  present: number;
  /** Rows that did not pass their checks, or whose parent is not in the file. */
  invalid: number;
  /** Rows made without a link, because what they pointed at is not in the file or the account. */
  unlinked: number;
  /** Left for a later run: they wait on a note that is. */
  deferred: number;
};

export type RestoreReport = {
  apply: boolean;
  kinds: Record<RestoreKind, KindReport>;
  invalid: RowProblem[];
  invalidTotal: number;
  /** Rows past the per-table cap of one file. */
  overCap: number;
  /** Notes created under another title because the account already has a different note by that title. */
  renamed: { from: string; to: string }[];
  /** Events a calendar feed brought in: not restored; adding the feed again brings them back. */
  fromFeed: number;
  /** Rows whose write failed (a reference with a duplicate key, say). */
  failed: number;
  notRestored: Readonly<Record<string, string>>;
};

export type RestoreOutcome = { ok: true; report: RestoreReport } | { ok: false; message: string };

const empty = (found: number): KindReport => ({ found, create: 0, created: 0, present: 0, invalid: 0, unlinked: 0, deferred: 0 });

export async function runJsonRestore(userId: string, bytes: Uint8Array, options: { apply: boolean }): Promise<RestoreOutcome> {
  if (typeof userId !== "string" || userId === "") throw new AppError("AUTH_REQUIRED", "Sign in first.");
  const parsed = parseExportFile(bytes);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const { rows, found, invalid, invalidTotal, overCap } = parsed.file;
  const { apply } = options;

  const kinds = Object.fromEntries(RESTORE_KINDS.map((kind) => [kind, empty(found[kind])])) as Record<RestoreKind, KindReport>;
  const report: RestoreReport = {
    apply,
    kinds,
    invalid,
    invalidTotal,
    overCap,
    renamed: [],
    fromFeed: 0,
    failed: 0,
    notRestored: NOT_RESTORED,
  };
  const map = new IdMap();

  // The id of the row in this account for a link in the file, counting a link that goes nowhere.
  const link = (kind: RestoreKind, oldId: string | null, counts: KindReport): string | null => {
    if (oldId === null) return null;
    const id = map.get(kind, oldId);
    if (id === null) counts.unlinked += 1;
    return id;
  };

  // --- courses ---------------------------------------------------------------------------------
  const courseIds = new Map((await repo.existing.courses(userId)).map((row) => [keys.course(row.code, row.term), row.id] as const));
  const newCourses: Parameters<typeof repo.insert.courses>[1] = [];
  for (const row of rows.courses) {
    const key = keys.course(row.code, row.term);
    const have = courseIds.get(key);
    if (have) {
      map.set("courses", row.id, have);
      kinds.courses.present += 1;
      continue;
    }
    const id = randomUUID();
    courseIds.set(key, id);
    map.set("courses", row.id, id);
    newCourses.push({ id, code: row.code, title: row.title, term: row.term, credits: row.credits, finalGrade: row.finalGrade });
  }
  kinds.courses.create = newCourses.length;
  if (apply) {
    await repo.insert.courses(userId, newCourses);
    kinds.courses.created = newCourses.length;
  }

  // --- goals, then projects (a project may sit under a goal) ------------------------------------
  const goalIds = new Map((await repo.existing.goals(userId)).map((row) => [keys.goal(row.title), row.id] as const));
  const touchedGoals = new Set<string>();
  for (const row of rows.goals) {
    const key = keys.goal(row.title);
    const have = goalIds.get(key);
    if (have) {
      map.set("goals", row.id, have);
      kinds.goals.present += 1;
      continue;
    }
    kinds.goals.create += 1;
    let id: string = randomUUID();
    if (apply) {
      try {
        id = (await goalService.createGoal(userId, { title: row.title, description: row.description, category: row.category, targetDate: row.targetDate })).id;
        kinds.goals.created += 1;
      } catch (error) {
        report.failed += 1;
        console.error("[WARN] restore: goal not created:", error);
        continue;
      }
    }
    goalIds.set(key, id);
    map.set("goals", row.id, id);
    touchedGoals.add(id);
  }

  const projectIds = new Map((await repo.existing.projects(userId)).map((row) => [keys.project(row.title), row.id] as const));
  const touchedProjects = new Set<string>();
  for (const row of rows.projects) {
    const key = keys.project(row.title);
    const have = projectIds.get(key);
    if (have) {
      map.set("projects", row.id, have);
      kinds.projects.present += 1;
      continue;
    }
    kinds.projects.create += 1;
    const goalId = link("goals", row.goalId, kinds.projects);
    let id: string = randomUUID();
    if (apply) {
      try {
        id = (await projectService.createProject(userId, { title: row.title, category: row.category, goalId })).id;
        kinds.projects.created += 1;
      } catch (error) {
        report.failed += 1;
        console.error("[WARN] restore: project not created:", error);
        continue;
      }
    }
    projectIds.set(key, id);
    map.set("projects", row.id, id);
    touchedProjects.add(id);
  }

  // --- assessments -------------------------------------------------------------------------------
  const assessmentIds = new Map(
    (await repo.existing.assessments(userId)).map((row) => [keys.assessment(row.courseId, row.title, row.dueDate), row.id] as const),
  );
  const newAssessments: Parameters<typeof repo.insert.assessments>[1] = [];
  const coursesToIndex = new Set(newCourses.map((course) => course.id));
  for (const row of rows.assessments) {
    const courseId = map.get("courses", row.courseId);
    if (courseId === null) {
      kinds.assessments.invalid += 1; // a grade with no course in the file or the account has nowhere to live
      continue;
    }
    const key = keys.assessment(courseId, row.title, row.dueDate);
    const have = assessmentIds.get(key);
    if (have) {
      map.set("assessments", row.id, have);
      kinds.assessments.present += 1;
      continue;
    }
    const id = randomUUID();
    assessmentIds.set(key, id);
    map.set("assessments", row.id, id);
    newAssessments.push({ id, courseId, title: row.title, weight: row.weight, score: row.score, maxScore: row.maxScore, dueDate: row.dueDate });
    coursesToIndex.add(courseId);
  }
  kinds.assessments.create = newAssessments.length;
  if (apply) {
    await repo.insert.assessments(userId, newAssessments);
    kinds.assessments.created = newAssessments.length;
  }

  // --- notes: the vault importer's rule (same title family and text is already there; a different note under a
  //     title the account uses comes in as "Title (imported)", so it does not take [[Title]] from the real one) ----
  const existingNotes = await repo.existing.notes(userId);
  const noteIdByKey = new Map<string, string>();
  for (const note of existingNotes) {
    const key = `${family(note.title)}\u0000${note.hash}`;
    if (!noteIdByKey.has(key)) noteIdByKey.set(key, note.id);
  }
  const incoming = new Map<string, (typeof rows.notes)[number]>();
  const parsedNotes: ParsedNote[] = rows.notes.map((row, index) => {
    const path = String(index).padStart(8, "0");
    incoming.set(path, row);
    return {
      path,
      title: row.title,
      content: row.content,
      tags: row.tags,
      favorite: row.isFavorite,
      course: null,
      project: null,
      attachments: [],
      ours: true,
      droppedProperties: [],
    };
  });
  const plan = planImport(existingNotes, parsedNotes, RESTORE_LIMITS.notesPerRun);
  const deferredNotes = new Set<string>();
  for (const note of plan.deferred) {
    const oldId = incoming.get(note.path)?.id;
    if (oldId !== undefined) deferredNotes.add(oldId);
    kinds.notes.deferred += 1;
  }
  kinds.notes.create = plan.create.length;
  for (const note of plan.create) {
    const row = incoming.get(note.path)!;
    if (note.renamed) report.renamed.push({ from: note.title, to: note.finalTitle });
    const projectId = link("projects", row.projectId, kinds.notes);
    const courseId = link("courses", row.courseId, kinds.notes);
    let id: string = randomUUID();
    if (apply) {
      try {
        id = (
          await noteService.createNote(userId, {
            title: note.finalTitle,
            content: note.content,
            tags: note.tags,
            isFavorite: note.favorite,
            projectId,
            courseId,
          })
        ).id;
        kinds.notes.created += 1;
      } catch (error) {
        report.failed += 1;
        console.error("[WARN] restore: note not created:", error);
        continue;
      }
    }
    noteIdByKey.set(`${family(note.title)}\u0000${contentHash(note.content)}`, id);
    map.set("notes", row.id, id);
  }
  // After the creating, so a note that is a copy of an earlier one in the same file finds the one just made.
  for (const note of plan.present) {
    const row = incoming.get(note.path)!;
    const id = noteIdByKey.get(`${family(note.title)}\u0000${contentHash(note.content)}`);
    if (id) map.set("notes", row.id, id);
    kinds.notes.present += 1;
  }
  const waitsOnNote = (oldNoteId: string | null) => oldNoteId !== null && deferredNotes.has(oldNoteId);

  // --- tasks and their checklists ----------------------------------------------------------------
  const taskKeys = new Set(
    (await repo.existing.tasks(userId)).map((row) => keys.task(row.title, row.dueDate, row.courseId)),
  );
  const recurrence = new Map<string, string>();
  const newTasks: Parameters<typeof repo.insert.tasks>[1] = [];
  const createdTaskIds = new Map<string, string>();
  const now = new Date();
  for (const row of rows.tasks) {
    if (waitsOnNote(row.noteId)) {
      kinds.tasks.deferred += 1;
      continue;
    }
    const courseId = link("courses", row.courseId, kinds.tasks);
    const key = keys.task(row.title, row.dueDate, courseId);
    if (taskKeys.has(key)) {
      kinds.tasks.present += 1;
      continue;
    }
    taskKeys.add(key);
    const projectId = link("projects", row.projectId, kinds.tasks);
    const goalId = link("goals", row.goalId, kinds.tasks);
    const assessmentId = link("assessments", row.assessmentId, kinds.tasks);
    const noteId = link("notes", row.noteId, kinds.tasks);
    let recurrenceId: string | null = null;
    if (row.recurrenceId !== null) {
      recurrenceId = recurrence.get(row.recurrenceId) ?? randomUUID();
      recurrence.set(row.recurrenceId, recurrenceId);
    }
    const schedule = normaliseSchedule(row.scheduledStart, row.scheduledEnd);
    const id = randomUUID();
    if (row.id !== undefined) createdTaskIds.set(row.id, id);
    newTasks.push({
      id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      tags: row.tags,
      dueDate: row.dueDate,
      estimatedMinutes: row.estimatedMinutes,
      scheduledStart: schedule.start,
      scheduledEnd: schedule.end,
      // Completion follows status, as everywhere else in the app: never a free field from a file.
      completedAt: row.status === "done" ? (row.completedAt ?? now) : null,
      recurrenceId,
      projectId,
      courseId,
      noteId,
      goalId,
      assessmentId,
    });
    if (projectId) touchedProjects.add(projectId);
    if (goalId) touchedGoals.add(goalId);
  }
  kinds.tasks.create = newTasks.length;
  if (apply) {
    await repo.insert.tasks(userId, newTasks);
    kinds.tasks.created = newTasks.length;
  }

  const seenSteps = new Set<string>();
  const newSteps: Parameters<typeof repo.insert.checklistItems>[1] = [];
  for (const row of rows.checklistItems) {
    const taskId = createdTaskIds.get(row.taskId);
    if (taskId === undefined) {
      // A step of a task that was already here or is not in the file: left alone (it is the task's own list).
      kinds.checklistItems.present += 1;
      continue;
    }
    const key = keys.checklist(taskId, row.title);
    if (seenSteps.has(key)) {
      kinds.checklistItems.present += 1;
      continue;
    }
    seenSteps.add(key);
    newSteps.push({ taskId, title: row.title, done: row.done, position: row.position });
  }
  kinds.checklistItems.create = newSteps.length;
  if (apply) {
    await repo.insert.checklistItems(userId, newSteps);
    kinds.checklistItems.created = newSteps.length;
  }

  // --- events ------------------------------------------------------------------------------------
  const eventKeys = new Set((await repo.existing.events(userId)).map((row) => keys.event(row.title, row.startTime, row.endTime)));
  const eventRecurrence = new Map<string, string>();
  const newEvents: Parameters<typeof repo.insert.events>[1] = [];
  for (const row of rows.events) {
    if (row.subscriptionId !== null || row.externalUid) {
      report.fromFeed += 1;
      continue;
    }
    if (row.endTime.getTime() <= row.startTime.getTime()) {
      kinds.events.invalid += 1;
      continue;
    }
    const key = keys.event(row.title, row.startTime, row.endTime);
    if (eventKeys.has(key)) {
      kinds.events.present += 1;
      continue;
    }
    eventKeys.add(key);
    let recurrenceId: string | null = null;
    if (row.recurrenceId !== null) {
      recurrenceId = eventRecurrence.get(row.recurrenceId) ?? randomUUID();
      eventRecurrence.set(row.recurrenceId, recurrenceId);
    }
    newEvents.push({
      id: randomUUID(),
      title: row.title,
      description: row.description,
      location: row.location,
      startTime: row.startTime,
      endTime: row.endTime,
      recurrenceId,
      projectId: link("projects", row.projectId, kinds.events),
      courseId: link("courses", row.courseId, kinds.events),
    });
  }
  kinds.events.create = newEvents.length;
  if (apply) {
    await repo.insert.events(userId, newEvents);
    kinds.events.created = newEvents.length;
  }

  // --- references (through the service: one schema checks every field, and a key is unique per account) ---
  const haveKeys = new Set((await repo.existing.referenceKeys(userId)).map(keys.reference));
  for (const row of rows.references) {
    const key = keys.reference(row.key);
    if (haveKeys.has(key)) {
      kinds.references.present += 1;
      continue;
    }
    const input = { ...row.details, key: row.key, type: row.type, title: row.title, authors: row.authors, year: row.year ?? null };
    // Checked in a preview too, so what it promises is what apply does.
    if (!referenceSchema.safeParse(input).success) {
      kinds.references.invalid += 1;
      continue;
    }
    if (apply) {
      try {
        await referenceService.createReference(userId, input);
        kinds.references.created += 1;
      } catch (error) {
        if (error instanceof AppError) {
          kinds.references.invalid += 1;
          continue;
        }
        throw error;
      }
    }
    haveKeys.add(key);
    kinds.references.create += 1;
  }

  // --- weekly goals (through the service: one schema checks the measure and the target; one goal per measure) ---------------------------
  const haveMeasures = new Set(await repo.existing.weeklyGoalMeasures(userId));
  for (const row of rows.weeklyGoals) {
    if (haveMeasures.has(row.measure)) {
      kinds.weeklyGoals.present += 1;
      continue;
    }
    if (!goalSchema.safeParse({ measure: row.measure, target: row.target }).success) {
      kinds.weeklyGoals.invalid += 1;
      continue;
    }
    if (apply) {
      try {
        await weeklyGoalService.createGoal(userId, { measure: row.measure, target: row.target });
        kinds.weeklyGoals.created += 1;
      } catch (error) {
        if (error instanceof AppError) {
          kinds.weeklyGoals.invalid += 1;
          continue;
        }
        throw error;
      }
    }
    haveMeasures.add(row.measure);
    kinds.weeklyGoals.create += 1;
  }

  // --- cards of the notes that came back -----------------------------------------------------------
  const cardKeys = new Set(
    (await repo.existing.flashcards(userId)).map((row) => keys.card(row.noteId, row.question, row.clozeIndex)),
  );
  const newCards: Parameters<typeof repo.insert.flashcards>[1] = [];
  for (const row of rows.flashcards) {
    if (waitsOnNote(row.noteId)) {
      kinds.flashcards.deferred += 1;
      continue;
    }
    const noteId = map.get("notes", row.noteId);
    if (row.noteId !== null && noteId === null) {
      kinds.flashcards.invalid += 1; // its note is not in the file or the account, so there is no deck for it
      continue;
    }
    const key = keys.card(noteId, row.question, row.clozeIndex);
    if (cardKeys.has(key)) {
      kinds.flashcards.present += 1;
      continue;
    }
    cardKeys.add(key);
    newCards.push({
      noteId,
      question: row.question,
      answer: row.answer,
      clozeIndex: row.clozeIndex,
      easeFactor: row.easeFactor,
      intervalDays: row.intervalDays,
      repetitions: row.repetitions,
      dueAt: row.dueAt,
      lastReviewed: row.lastReviewed,
    });
  }
  kinds.flashcards.create = newCards.length;
  if (apply) {
    await repo.insert.flashcards(userId, newCards);
    kinds.flashcards.created = newCards.length;
  }

  // --- derived values and the search index ---------------------------------------------------------------
  if (apply) {
    for (const projectId of touchedProjects) await projectService.recalculateProgress(userId, projectId);
    for (const goalId of touchedGoals) await goalService.recalculateGoalProgress(userId, goalId);
    for (const courseId of coursesToIndex) await courseService.indexCourse(userId, courseId);
  }
  return { ok: true, report };
}
