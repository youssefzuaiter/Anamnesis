import "server-only";
import { AppError } from "@/lib/api-response";
import type { AssistantScope, ScopeKind } from "@/lib/assistant-scope";
import type { SourceFilter } from "@/lib/vector";
import * as scopeRepository from "@/repositories/scope-repository";

export type ResolvedScope = {
  scope: AssistantScope;
  /** What to call it: `CMP2003 — Machine Learning`, a project's title, a note's title. */
  label: string;
  /** Everything a question with this scope may search. */
  within: SourceFilter;
};

const NOT_FOUND: Record<ScopeKind, string> = {
  course: "That course no longer exists.",
  project: "That project no longer exists.",
  note: "That note no longer exists.",
};

/**
 * Refuses a scope that is not the caller's own live course, project or note.
 * One lookup scoped by `userId`, so another account's id finds nothing, the
 * same as an id that never existed. The chat route uses it to answer a bad
 * scope with a 404 before a thread is opened, without listing members.
 */
export async function assertScopeOwned(
  userId: string,
  scope: AssistantScope,
): Promise<{ id: string; label: string }> {
  const entity = await scopeRepository.getScopeEntity(userId, scope);
  if (!entity) throw new AppError("RESOURCE_NOT_FOUND", NOT_FOUND[scope.kind]);
  return entity;
}

/**
 * Turns a scope from the browser into what it may search. The id is client
 * input, so it must be the caller's own live course, project or note (a lookup
 * scoped by `userId`); another account's id, a deleted one, one that never
 * existed and a valid id of the wrong kind are all the same refusal, made
 * before anything is embedded or searched. Membership is worked out now, so
 * moving a note, task or event between courses takes effect at once.
 */
export async function resolveScope(
  userId: string,
  scope: AssistantScope,
): Promise<ResolvedScope> {
  const entity = await assertScopeOwned(userId, scope);

  if (scope.kind === "note") {
    return { scope, label: entity.label, within: { note: [entity.id] } };
  }

  const members = await scopeRepository.listScopeMembers(userId, scope);
  // The scope's own row is searched too, so its id goes under its own kind. Written out per kind rather than as `within[scope.kind]`, so no
  // property name is ever taken from a value that came from the browser.
  const within: SourceFilter =
    scope.kind === "course"
      ? { note: members.notes, task: members.tasks, event: members.events, course: [entity.id] }
      : { note: members.notes, task: members.tasks, event: members.events, project: [entity.id] };
  return { scope, label: entity.label, within };
}
