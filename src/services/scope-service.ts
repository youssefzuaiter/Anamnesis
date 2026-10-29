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
  const entity = await scopeRepository.getScopeEntity(userId, scope);
  if (!entity) throw new AppError("RESOURCE_NOT_FOUND", NOT_FOUND[scope.kind]);

  if (scope.kind === "note") {
    return { scope, label: entity.label, within: { note: [entity.id] } };
  }

  const members = await scopeRepository.listScopeMembers(userId, scope);
  const within: SourceFilter = { note: members.notes, task: members.tasks, event: members.events };
  within[scope.kind] = [entity.id];
  return { scope, label: entity.label, within };
}
