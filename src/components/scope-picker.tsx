"use client";

import { useId } from "react";
import {
  formatScopeParam,
  parseScopeParam,
  scopeSentence,
  type AssistantScope,
} from "@/lib/assistant-scope";

export type ScopeChoice = { id: string; label: string };

export type ScopeChoices = {
  courses: ScopeChoice[];
  projects: ScopeChoice[];
  /** Offered only when the page was opened for one note. */
  note: ScopeChoice | null;
};

/** The name of the chosen scope, for the placeholder; null for Everything. */
export function scopeLabel(choices: ScopeChoices, scope: AssistantScope | null): string | null {
  if (!scope) return null;
  const list =
    scope.kind === "course" ? choices.courses : scope.kind === "project" ? choices.projects : choices.note ? [choices.note] : [];
  return list.find((choice) => choice.id === scope.id)?.label ?? null;
}

/**
 * "Ask about": Everything, one course, one project, or the note the page was
 * opened for. A native select, so the keyboard and the phone's own picker work,
 * with a sentence under it saying exactly what a choice searches.
 */
export function ScopePicker({
  value,
  choices,
  onChange,
}: {
  value: AssistantScope | null;
  choices: ScopeChoices;
  onChange: (scope: AssistantScope | null) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-text-faint">
        Ask about
      </label>
      <select
        id={id}
        value={value ? formatScopeParam(value) : ""}
        onChange={(event) => onChange(parseScopeParam(event.target.value))}
        className="min-h-11 w-full max-w-sm rounded-lg border border-control bg-surface px-3 text-sm text-text"
      >
        <option value="">Everything</option>
        {choices.courses.length > 0 && (
          <optgroup label="Courses">
            {choices.courses.map((course) => (
              <option key={course.id} value={formatScopeParam({ kind: "course", id: course.id })}>
                {course.label}
              </option>
            ))}
          </optgroup>
        )}
        {choices.projects.length > 0 && (
          <optgroup label="Projects">
            {choices.projects.map((project) => (
              <option key={project.id} value={formatScopeParam({ kind: "project", id: project.id })}>
                {project.label}
              </option>
            ))}
          </optgroup>
        )}
        {choices.note && (
          <optgroup label="This note">
            <option value={formatScopeParam({ kind: "note", id: choices.note.id })}>
              {choices.note.label}
            </option>
          </optgroup>
        )}
      </select>
      {value && (
        <p className="text-xs leading-normal text-text-muted">{scopeSentence(value.kind)}</p>
      )}
    </div>
  );
}
