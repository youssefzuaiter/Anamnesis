/**
 * The starting points offered on "New note". A template is data: adding one is
 * one entry in `NOTE_TEMPLATES`, and the unit tests enumerate that array, so a
 * new entry is checked without editing a test. This module has no React and no
 * Prisma, so it can be used from a server page, a client component and a test.
 */

export type NoteTemplate = {
  id: string;
  name: string;
  /** One line shown under the chips while this template is selected. */
  description: string;
  /** May contain `{date}`, replaced by `dateLabel` when the template is rendered. */
  title: string;
  tags: readonly string[];
  /** Markdown. Ends with a newline, so the cursor has a line to start on. */
  body: string;
};

/** What a template writes into the note form. `tags` is the form's own comma-separated text. */
export type TemplateFields = { title: string; content: string; tags: string };

export const BLANK_TEMPLATE_ID = "blank";

const lines = (...parts: string[]) => parts.join("\n");

export const NOTE_TEMPLATES: readonly NoteTemplate[] = [
  {
    id: BLANK_TEMPLATE_ID,
    name: "Blank",
    description: "An empty note.",
    title: "",
    tags: [],
    body: "",
  },
  {
    id: "lecture",
    name: "Lecture",
    description:
      "Topic, key ideas, definitions, worked examples, questions to look up and a summary.",
    title: "Lecture, {date}",
    tags: ["lecture"],
    body: lines(
      "## Topic and course",
      "",
      "## Key ideas",
      "- ",
      "",
      "## Definitions and formulas",
      "- ",
      "",
      "## Examples from class",
      "- ",
      "",
      "## Questions to look up",
      "- [ ] ",
      "",
      "## Summary in my own words",
      "",
    ),
  },
  {
    id: "cornell",
    name: "Cornell",
    description: "Cues on top, notes below, and a summary you write afterwards.",
    title: "Cornell notes, {date}",
    tags: ["cornell"],
    // Headings rather than the classic two columns: a Markdown table cannot hold
    // several lines in a cell, so notes written in one would be unusable.
    body: lines(
      "## Cues and questions",
      "- ",
      "",
      "## Notes",
      "- ",
      "",
      "## Summary",
      "Write two or three sentences after the lecture, without looking at the notes above.",
      "",
    ),
  },
  {
    id: "paper",
    name: "Paper summary",
    description:
      "Reference, problem, method, results, limits, and why it matters to you.",
    title: "Paper summary",
    tags: ["paper"],
    body: lines(
      "## Reference",
      "Authors, year, venue.",
      "",
      "## Problem",
      "",
      "## Method",
      "",
      "## Results",
      "",
      "## Limits and open questions",
      "",
      "## Why it matters to me",
      "",
    ),
  },
  {
    id: "meeting",
    name: "Meeting",
    description:
      "Attendees, agenda, decisions and action items as tasks to tick.",
    title: "Meeting, {date}",
    tags: ["meeting"],
    body: lines(
      "## Attendees",
      "- ",
      "",
      "## Agenda",
      "- ",
      "",
      "## Decisions",
      "- ",
      "",
      "## Action items",
      "- [ ] ",
      "",
    ),
  },
];

/**
 * Looks a template up by exact id. Anything else, including a missing value,
 * `__proto__` or a very long string from a URL, is Blank: this is fed from the
 * `?template=` query parameter, so it must never throw.
 */
export function getTemplate(id: string | null | undefined): NoteTemplate {
  return NOTE_TEMPLATES.find((template) => template.id === id) ?? NOTE_TEMPLATES[0];
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** "Wed 28 Oct", built from the formatter's parts so the order never depends on the runtime's pattern. */
export function dateLabel(now: Date): string {
  const parts = DATE_FORMAT.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}`;
}

export function renderTemplate(template: NoteTemplate, now: Date): TemplateFields {
  return {
    title: template.title.replaceAll("{date}", dateLabel(now)),
    content: template.body,
    tags: template.tags.join(", "),
  };
}

/** What the note form holds now, and which template it was last filled from. */
export type CurrentNote = TemplateFields & { templateId: string };

export type TemplateChange =
  | { action: "none" }
  | { action: "confirm" }
  | { action: "apply"; values: TemplateFields };

/**
 * The fields to write when `targetId` is chosen. Content always becomes the
 * target's outline. The title and tags are only replaced when they were never
 * typed: empty, or still exactly what the previous template wrote. A title
 * built from yesterday's date therefore counts as typed and is kept, which
 * errs on the side of losing nothing.
 */
export function applyTemplate(
  current: CurrentNote,
  targetId: string,
  now: Date,
): TemplateFields {
  const next = renderTemplate(getTemplate(targetId), now);
  const written = renderTemplate(getTemplate(current.templateId), now);
  const untouched = (value: string, writtenByTemplate: string) =>
    value.trim() === "" || value.trim() === writtenByTemplate.trim();

  return {
    title: untouched(current.title, written.title) ? next.title : current.title,
    content: next.content,
    tags: untouched(current.tags, written.tags) ? next.tags : current.tags,
  };
}

/**
 * What choosing a template should do. Replacing text the person wrote is the
 * one thing that must be asked about, so a changed body means `confirm`; a body
 * that is still the selected template's own (ignoring surrounding whitespace)
 * is swapped at once.
 */
export function planTemplateChange({
  current,
  targetId,
  now,
}: {
  current: CurrentNote;
  targetId: string;
  now: Date;
}): TemplateChange {
  const target = getTemplate(targetId);
  const selected = getTemplate(current.templateId);

  if (target.id === selected.id) return { action: "none" };
  if (current.content.trim() !== selected.body.trim()) return { action: "confirm" };
  return { action: "apply", values: applyTemplate(current, target.id, now) };
}
