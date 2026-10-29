import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { AssistantChat } from "@/components/assistant-chat";
import { ConversationList } from "@/components/conversation-list";
import {
  listConversations,
  getConversation,
} from "@/repositories/conversation-repository";
import type { Citation } from "@/services/assistant-service";
import { formatScopeParam, parseScopeParam } from "@/lib/assistant-scope";
import type { ScopeChoices } from "@/components/scope-picker";
import { listCourseOptions } from "@/repositories/course-repository";
import { listProjectOptions } from "@/repositories/project-repository";
import { getScopeEntity } from "@/repositories/scope-repository";

export const metadata = { title: "Assistant · Anamnesis" };

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

export default async function AssistantPage({
  searchParams,
}: PageProps<"/ai">) {
  const userId = await requireUserId();
  const params = await searchParams;
  const requested = typeof params.c === "string" ? params.c : null;
  // A scope named in the URL counts only if it is the caller's own; a malformed
  // one, another account's, or a deleted one is just "Everything".
  const requestedScope = parseScopeParam(params.scope);

  const [indexedChunks, conversations, active, courses, projects, scopeEntity] =
    await Promise.all([
      prisma.workspaceEmbedding.count({ where: { userId } }),
      listConversations(userId),
      requested ? getConversation(userId, requested) : Promise.resolve(null),
      listCourseOptions(userId),
      listProjectOptions(userId),
      requestedScope ? getScopeEntity(userId, requestedScope) : Promise.resolve(null),
    ]);
  const scope = scopeEntity ? requestedScope : null;
  const scopeChoices: ScopeChoices = {
    courses: courses.map((course) => ({ id: course.id, label: `${course.code} — ${course.title}` })),
    projects: projects.map((project) => ({ id: project.id, label: project.title })),
    note: scopeEntity && scope?.kind === "note" ? { id: scopeEntity.id, label: scopeEntity.label } : null,
  };

  // Proposals are deliberately not replayed: confirming one is a live
  // decision, and a reopened thread showing yesterday's buttons would invite
  // acting on a request whose context has moved on. The audit log is where
  // past proposals are reviewed.
  const initialTurns =
    active?.messages.map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
      citations: (message.citations as Citation[] | null) ?? undefined,
    })) ?? [];

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Assistant
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {indexedChunks === 0
            ? "Nothing is indexed yet — write a note and it becomes searchable here."
            : `Grounded in ${indexedChunks} indexed ${indexedChunks === 1 ? "chunk" : "chunks"} from your workspace.`}
        </p>
      </header>

      <div className="flex flex-1 flex-col gap-6 sm:flex-row">
        <div className="sm:w-56 sm:shrink-0">
          <ConversationList
            activeId={active?.id ?? null}
            conversations={conversations.map((conversation) => ({
              id: conversation.id,
              title: conversation.title,
              when: WHEN.format(conversation.updatedAt),
              messageCount: conversation.messageCount,
            }))}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <AssistantChat
            key={`${active?.id ?? "new"}:${scope ? formatScopeParam(scope) : ""}`}
            conversationId={active?.id ?? null}
            initialTurns={initialTurns}
            scopeChoices={scopeChoices}
            initialScope={scope}
          />
        </div>
      </div>
    </div>
  );
}
