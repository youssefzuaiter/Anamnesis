/**
 * What a scoped question to the assistant is limited to: one course, one
 * project or one note. Pure, so the rules for reading one from a request or a
 * URL can be tested without a database.
 *
 * The scope only ever names something; it is checked against the signed-in
 * account's own data before it is used (`services/scope-service.ts`).
 */

import { z } from "zod";

export const SCOPE_KINDS = ["course", "project", "note"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

export type AssistantScope = { kind: ScopeKind; id: string };

/** Strict: a stray key (a `userId`, say) is a rejected request, not an ignored one. */
export const assistantScopeSchema = z
  .object({ kind: z.enum(SCOPE_KINDS), id: z.uuid() })
  .strict();

/**
 * Reads `?scope=course:<uuid>`. Only a single string of exactly that shape
 * counts; a repeated parameter (an array), stray spaces, an upper-case kind or
 * anything after the id is "no scope", which is the same as Everything.
 */
export function parseScopeParam(value: string | string[] | undefined): AssistantScope | null {
  if (typeof value !== "string") return null;
  const match = /^(course|project|note):([0-9a-fA-F-]{36})$/.exec(value);
  if (!match) return null;
  const parsed = assistantScopeSchema.safeParse({ kind: match[1], id: match[2] });
  return parsed.success ? parsed.data : null;
}

export function formatScopeParam(scope: AssistantScope): string {
  return `${scope.kind}:${scope.id}`;
}

/** The assistant page with this scope already chosen. */
export function scopeHref(scope: AssistantScope): string {
  return `/ai?scope=${formatScopeParam(scope)}`;
}

/** What a chosen scope searches, said once under the control. */
export function scopeSentence(kind: ScopeKind): string {
  switch (kind) {
    case "course":
      return "Searching only this course: its notes, tasks, events and grades.";
    case "project":
      return "Searching only this project: its notes, tasks and events.";
    case "note":
      return "Searching only this note.";
  }
}
