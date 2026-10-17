import "server-only";
import { prisma } from "@/lib/prisma";

// "course" and "goal" are included for the semantic /search page and
// RelatedItems (see EmbeddableSourceType in lib/vector.ts) — the literal
// command-palette search below never emits either, since quickSearch stays
// scoped to the four entity types it has always covered.
export type SearchHit = {
  id: string;
  kind: "note" | "task" | "event" | "project" | "course" | "goal";
  title: string;
  detail: string | null;
  href: string;
};

const PER_KIND = 5;

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

/**
 * Literal substring search for the command palette. Deliberately not semantic:
 * the palette runs on every keystroke, and an embedding round trip per keypress
 * would be both slow and wasteful. Semantic search lives on the notes page and
 * in the assistant.
 */
export async function quickSearch(
  userId: string,
  query: string,
): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const contains = { contains: q, mode: "insensitive" as const };

  const [notes, tasks, events, projects] = await Promise.all([
    prisma.note.findMany({
      where: {
        userId,
        deletedAt: null,
        OR: [{ title: contains }, { content: contains }],
      },
      orderBy: { updatedAt: "desc" },
      take: PER_KIND,
      select: { id: true, title: true, tags: true },
    }),
    prisma.task.findMany({
      where: {
        userId,
        deletedAt: null,
        OR: [{ title: contains }, { description: contains }],
      },
      orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }],
      take: PER_KIND,
      select: { id: true, title: true, status: true, dueDate: true },
    }),
    prisma.event.findMany({
      where: {
        userId,
        OR: [{ title: contains }, { location: contains }],
      },
      orderBy: { startTime: "desc" },
      take: PER_KIND,
      select: { id: true, title: true, startTime: true, location: true },
    }),
    prisma.project.findMany({
      where: { userId, deletedAt: null, title: contains },
      orderBy: { updatedAt: "desc" },
      take: PER_KIND,
      select: { id: true, title: true, category: true, progress: true },
    }),
  ]);

  return [
    ...notes.map((note) => ({
      id: note.id,
      kind: "note" as const,
      title: note.title,
      detail: note.tags.length > 0 ? note.tags.join(", ") : null,
      href: `/notes/${note.id}`,
    })),
    ...tasks.map((task) => ({
      id: task.id,
      kind: "task" as const,
      title: task.title,
      detail: [
        task.status === "done" ? "done" : null,
        task.dueDate ? DATE.format(task.dueDate) : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
      href: `/tasks/${task.id}`,
    })),
    ...events.map((event) => ({
      id: event.id,
      kind: "event" as const,
      title: event.title,
      detail: [DATE.format(event.startTime), event.location]
        .filter(Boolean)
        .join(" · "),
      href: `/calendar/${event.id}`,
    })),
    ...projects.map((project) => ({
      id: project.id,
      kind: "project" as const,
      title: project.title,
      detail: `${project.category} · ${project.progress}%`,
      href: `/projects/${project.id}`,
    })),
  ];
}
