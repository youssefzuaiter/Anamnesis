"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteConversationAction } from "@/actions/conversations";

export type ConversationRow = {
  id: string;
  title: string;
  when: string;
  messageCount: number;
};

export function ConversationList({
  conversations,
  activeId,
}: {
  conversations: ConversationRow[];
  activeId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <aside className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold text-text-faint">
          Threads
        </h2>
        {activeId && (
          <Link href="/ai" className="text-xs text-accent hover:underline">
            New
          </Link>
        )}
      </div>

      {conversations.length === 0 ? (
        <p className="text-xs text-text-muted">
          Nothing yet — a thread is saved as soon as you ask something.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {conversations.map((conversation) => (
            <li key={conversation.id} className="group flex items-center gap-1">
              <Link
                href={`/ai?c=${conversation.id}`}
                className={`min-w-0 flex-1 truncate rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                  conversation.id === activeId
                    ? "bg-accent-soft text-accent"
                    : "text-text-muted hover:bg-surface-subtle hover:text-text"
                }`}
                title={conversation.title}
              >
                {conversation.title}
              </Link>
              <button
                type="button"
                disabled={pending}
                aria-label={`Delete thread ${conversation.title}`}
                onClick={() => {
                  if (!confirm("Delete this thread?")) return;
                  startTransition(async () => {
                    await deleteConversationAction(conversation.id);
                    if (conversation.id === activeId) router.push("/ai");
                    else router.refresh();
                  });
                }}
                className="shrink-0 px-1 text-xs text-text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
