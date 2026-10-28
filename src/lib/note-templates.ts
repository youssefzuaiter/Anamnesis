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
