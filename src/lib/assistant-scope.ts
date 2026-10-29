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

/** A stable key for a scope: its URL form, and "" for Everything. */
export function scopeKey(scope: AssistantScope | null): string {
  return scope ? formatScopeParam(scope) : "";
}

type HistoryTurn = {
  role: "user" | "assistant";
  content: string;
  /** The scope key the turn was asked under; absent on turns loaded from a saved thread. */
  scope?: string;
  error?: string;
};

/**
 * The turns of a thread that may go to the model as history for a question
 * asked under `scope`: only those asked under the same scope. Earlier turns
 * carry whatever was retrieved for them, so sending ones from another scope
 * lets the model answer from material the new scope is meant to exclude, and
 * cite a note that says nothing of the kind. A turn with no recorded scope
 * counts as Everything, so a saved thread's turns are never carried into a
 * scoped question. A failed turn is never sent.
 */
export function historyForScope(
  turns: readonly HistoryTurn[],
  scope: AssistantScope | null,
): { role: "user" | "assistant"; content: string }[] {
  const key = scopeKey(scope);
  return turns
    .filter((turn) => !turn.error && (turn.scope ?? "") === key)
    .map(({ role, content }) => ({ role, content }));
}
