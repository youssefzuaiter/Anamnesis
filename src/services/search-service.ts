import "server-only";
import { prisma } from "@/lib/prisma";
import { embedQuery } from "@/lib/ollama";
import {
  searchWorkspaceVectors,
  findSimilarEntities,
  type EmbeddableSourceType,
} from "@/lib/vector";
import type { SearchHit } from "@/repositories/search-repository";

export type SemanticHit = SearchHit & { similarity: number };

export type SemanticSearchResult = {
  mode: "semantic" | "unavailable";
  hits: SemanticHit[];
};

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * Turns vector hits into things that can be linked to. Everything is fetched in
 * one round per type and scoped by `userId` again here — the embedding rows are
 * already per-tenant, but a resolver that trusted an id it was handed would be
 * one bug away from crossing accounts.
 */
async function resolve(
  userId: string,
  ids: Record<EmbeddableSourceType, string[]>,
): Promise<Map<string, SearchHit>> {
  const [notes, tasks, events, projects, courses, goals] = await Promise.all([
    ids.note.length
      ? prisma.note.findMany({
          where: { userId, deletedAt: null, id: { in: ids.note } },
          select: { id: true, title: true, tags: true },
        })
      : [],
    ids.task.length
      ? prisma.task.findMany({
          where: { userId, deletedAt: null, id: { in: ids.task } },
          select: { id: true, title: true, status: true, dueDate: true },
        })
      : [],
    ids.event.length
      ? prisma.event.findMany({
          where: { userId, id: { in: ids.event } },
          select: { id: true, title: true, startTime: true, location: true },
        })
      : [],
    ids.project.length
      ? prisma.project.findMany({
          where: { userId, deletedAt: null, id: { in: ids.project } },
          select: { id: true, title: true, category: true, progress: true },
        })
      : [],
    ids.course.length
      ? prisma.course.findMany({
          where: { userId, deletedAt: null, id: { in: ids.course } },
          select: { id: true, code: true, title: true, term: true },
        })
      : [],
    ids.goal.length
      ? prisma.goal.findMany({
          where: { userId, deletedAt: null, id: { in: ids.goal } },
          select: { id: true, title: true, category: true, progress: true },
        })
      : [],
  ]);

  const out = new Map<string, SearchHit>();

  for (const note of notes) {
    out.set(`note:${note.id}`, {
      id: note.id,
      kind: "note",
      title: note.title,
      detail: note.tags.length > 0 ? note.tags.join(", ") : null,
      href: `/notes/${note.id}`,
    });
  }
  for (const task of tasks) {
    out.set(`task:${task.id}`, {
      id: task.id,
      kind: "task",
      title: task.title,
      detail: [
        task.status === "done" ? "done" : "open",
        task.dueDate ? `due ${DATE.format(task.dueDate)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      href: `/tasks/${task.id}`,
    });
  }
  for (const event of events) {
    out.set(`event:${event.id}`, {
      id: event.id,
      kind: "event",
      title: event.title,
      detail: [DATE.format(event.startTime), event.location]
        .filter(Boolean)
        .join(" · "),
      href: `/calendar/${event.id}`,
    });
  }
  for (const project of projects) {
    out.set(`project:${project.id}`, {
      id: project.id,
      kind: "project",
      title: project.title,
      detail: `${project.category} · ${project.progress}%`,
      href: `/projects/${project.id}`,
    });
  }
  for (const course of courses) {
    out.set(`course:${course.id}`, {
      id: course.id,
      kind: "course",
      title: `${course.code} — ${course.title}`,
      detail: course.term,
      href: `/courses/${course.id}`,
    });
  }
  for (const goal of goals) {
    out.set(`goal:${goal.id}`, {
      id: goal.id,
      kind: "goal",
      title: goal.title,
      detail: `${goal.category} · ${goal.progress}%`,
      href: `/goals/${goal.id}`,
    });
  }

  return out;
}

function emptyIds(): Record<EmbeddableSourceType, string[]> {
  return { note: [], task: [], event: [], project: [], course: [], goal: [] };
}

/**
 * Semantic search across everything indexed, not just notes. Unlike the notes
 * page there is no keyword fallback: this page exists specifically to search by
 * meaning, and the command palette already covers literal matching.
 */
export async function searchEverything(
  userId: string,
  query: string,
  types?: EmbeddableSourceType[],
): Promise<SemanticSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { mode: "semantic", hits: [] };

  let results;
  try {
    results = await searchWorkspaceVectors(
      userId,
      await embedQuery(trimmed),
      30,
      types,
    );
  } catch (error) {
    console.error("[WARN] Workspace search unavailable:", error);
    return { mode: "unavailable", hits: [] };
  }

  // Several chunks of one entity can match; keep each entity once, at its best
  // score, in the order pgvector already ranked them.
  const best = new Map<string, number>();
  for (const hit of results) {
    const key = `${hit.sourceType}:${hit.sourceId}`;
    if (!best.has(key)) best.set(key, hit.similarity);
  }

  const ids = emptyIds();
  for (const key of best.keys()) {
    const [type, id] = key.split(":") as [EmbeddableSourceType, string];
    ids[type].push(id);
  }

  const resolved = await resolve(userId, ids);

  return {
    mode: "semantic",
    hits: [...best.entries()].flatMap(([key, similarity]) => {
      const hit = resolved.get(key);
      // A hit with no row behind it is a stale embedding, not a result.
      return hit ? [{ ...hit, similarity }] : [];
    }),
  };
}

/** What else in the workspace is about the same thing as this entity. */
export async function findRelated(
  userId: string,
  sourceType: EmbeddableSourceType,
  sourceId: string,
  limit = 5,
  targetTypes?: EmbeddableSourceType[],
): Promise<SemanticHit[]> {
  let similar;
  try {
    similar = await findSimilarEntities(
      userId,
      sourceType,
      sourceId,
      limit,
      targetTypes,
    );
  } catch (error) {
    console.error("[WARN] Related lookup unavailable:", error);
    return [];
  }

  const ids = emptyIds();
  for (const item of similar) ids[item.sourceType].push(item.sourceId);

  const resolved = await resolve(userId, ids);

  return similar.flatMap((item) => {
    const hit = resolved.get(`${item.sourceType}:${item.sourceId}`);
    return hit ? [{ ...hit, similarity: item.similarity }] : [];
  });
}
