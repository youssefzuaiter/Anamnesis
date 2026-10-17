import { summarise } from "@/lib/grades";

/**
 * How each entity is phrased for the embedding model, in one place.
 *
 * Entities are embedded as natural prose rather than "When: …/Where: …"
 * key-value lines. Measured against nomic-embed-text, the prose form scores
 * markedly higher on real questions — "where is my exam being held" went from
 * 0.52 (below the relevance floor, so invisible to the assistant) to 0.56, and
 * queries that already matched improved too. Phrase new entity types the same
 * way.
 *
 * These live here, rather than privately in each service, because the reindex
 * path has to produce byte-identical text to the write path. Two copies of a
 * measured phrasing would drift, and the only symptom would be quietly worse
 * retrieval for whichever rows were rebuilt.
 */

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

type NoteShape = { title: string; content: string; tags: string[] };

type TaskShape = {
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: Date | null;
  estimatedMinutes: number;
  tags: string[];
};

type EventShape = {
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  location: string | null;
};

type ProjectShape = { title: string; category: string; progress: number };

type GoalShape = {
  title: string;
  description: string | null;
  category: string;
  targetDate: Date | null;
  progress: number;
};

type CourseShape = { code: string; title: string; term: string };

type CourseAssessmentShape = {
  title: string;
  weight: number;
  score: number | null;
  maxScore: number;
  dueDate: Date | null;
};

export const embeddableTextFor = {
  note(note: NoteShape): string {
    const tagLine = note.tags.length > 0 ? `Tags: ${note.tags.join(", ")}` : "";
    return [note.title, tagLine, note.content].filter(Boolean).join("\n\n");
  },

  task(task: TaskShape): string {
    const due = task.dueDate
      ? `, due ${DATE_FORMAT.format(task.dueDate)}`
      : ", with no due date";

    const state = task.status === "done" ? " It is already completed." : "";

    const tagLine =
      task.tags.length > 0 ? ` It is tagged ${task.tags.join(", ")}.` : "";

    const sentence = `${task.title}. This is a task${due}, with ${task.priority} priority, estimated at ${task.estimatedMinutes} minutes.${state}${tagLine}`;

    return task.description ? `${sentence}\n\n${task.description}` : sentence;
  },

  event(event: EventShape): string {
    const sameDay =
      event.startTime.toDateString() === event.endTime.toDateString();

    const when = sameDay
      ? `on ${DATE_FORMAT.format(event.startTime)}, from ${TIME_FORMAT.format(event.startTime)} to ${TIME_FORMAT.format(event.endTime)}`
      : `from ${DATE_FORMAT.format(event.startTime)} at ${TIME_FORMAT.format(event.startTime)} until ${DATE_FORMAT.format(event.endTime)} at ${TIME_FORMAT.format(event.endTime)}`;

    const sentence = `${event.title}. This is a calendar event ${when}${
      event.location ? `, taking place at ${event.location}` : ""
    }.`;

    return event.description ? `${sentence}\n\n${event.description}` : sentence;
  },

  project(project: ProjectShape, taskSummary: string): string {
    return `${project.title}. This is a ${project.category.toLowerCase()} project, ${project.progress}% complete. ${taskSummary}`;
  },

  course(course: CourseShape, assessmentSummary: string): string {
    return `${course.code} — ${course.title}. This is a course from the ${course.term} term. ${assessmentSummary}`;
  },

  goal(goal: GoalShape, rollupSummary: string): string {
    const due = goal.targetDate
      ? `, targeting ${DATE_FORMAT.format(goal.targetDate)}`
      : "";
    const sentence = `${goal.title}. This is a ${goal.category.toLowerCase()} goal${due}, ${goal.progress}% complete. ${rollupSummary}`;
    return goal.description ? `${sentence}\n\n${goal.description}` : sentence;
  },
};

/** The task rundown appended to a project's embedded text. */
export function projectTaskSummary(
  tasks: { title: string; status: string }[],
): string {
  if (tasks.length === 0) return "It has no tasks yet.";
  return `Its tasks are: ${tasks
    .map((task) => `${task.title}${task.status === "done" ? " (done)" : ""}`)
    .join("; ")}.`;
}

/**
 * The projects-and-tasks rundown appended to a goal's embedded text. A goal
 * rolls up two kinds of children — unlike a project, which only ever has
 * tasks — so both are listed when present rather than folding one into the
 * other.
 */
export function goalRollupSummary(
  projects: { title: string; progress: number }[],
  tasks: { title: string; status: string }[],
): string {
  const parts: string[] = [];

  if (projects.length > 0) {
    parts.push(
      `Its projects are: ${projects
        .map((project) => `${project.title} (${project.progress}%)`)
        .join("; ")}.`,
    );
  }

  if (tasks.length > 0) {
    parts.push(
      `Its own tasks are: ${tasks
        .map((task) => `${task.title}${task.status === "done" ? " (done)" : ""}`)
        .join("; ")}.`,
    );
  }

  return parts.length > 0
    ? parts.join(" ")
    : "It has no projects or tasks linked yet.";
}

/**
 * The assessment rundown appended to a course's embedded text — the same role
 * `projectTaskSummary` plays for projects. Reuses `summarise()` from
 * `lib/grades.ts` rather than restating the arithmetic, so a question like
 * "what's my grade in X" and the grade panel's own numbers can never disagree.
 */
export function courseAssessmentSummary(
  assessments: CourseAssessmentShape[],
): string {
  if (assessments.length === 0) return "It has no assessments recorded yet.";

  const items = assessments.map((assessment) => {
    const due = assessment.dueDate
      ? `, due ${DATE_FORMAT.format(assessment.dueDate)}`
      : "";
    const graded =
      assessment.score === null
        ? ", not yet graded"
        : `, scored ${assessment.score}/${assessment.maxScore}`;
    return `${assessment.title} (worth ${assessment.weight}% of the course${due}${graded})`;
  });

  const summary = summarise(assessments);
  const gradeLine =
    summary.currentAverage === null
      ? " Nothing has been graded yet."
      : ` The current average across graded work is ${Math.round(summary.currentAverage)}%, and the best possible final mark, if everything remaining is scored perfectly, is ${Math.round(summary.bestPossible)}%.`;

  return `Its assessments are: ${items.join("; ")}.${gradeLine}`;
}
