import Link from "next/link";
import { requireUserId } from "@/lib/session";
import { listAuditTrail, type AuditEntry } from "@/services/action-service";

export const metadata = { title: "Audit log · Nexus" };

const ACTOR_LABEL: Record<string, string> = {
  AI_AGENT: "Assistant",
  USER: "You",
  SYSTEM: "System",
};

const ENTITY_HREF_PREFIX: Record<string, string> = {
  Task: "/tasks",
  Event: "/calendar",
  Note: "/notes",
  Goal: "/goals",
};

function proposedTitle(entry: AuditEntry): string | null {
  if (!entry.metadata || typeof entry.metadata !== "object") return null;
  const proposal = (entry.metadata as Record<string, unknown>).proposal;
  if (!proposal || typeof proposal !== "object") return null;
  const title = (proposal as Record<string, unknown>).title;
  return typeof title === "string" ? title : null;
}

function describe(entry: AuditEntry): { label: string; href: string | null } {
  switch (entry.action) {
    case "AI_MUTATION_PROPOSED": {
      const title = proposedTitle(entry);
      return {
        label: title
          ? `Assistant proposed a ${entry.entityType.toLowerCase()}: "${title}"`
          : `Assistant proposed a new ${entry.entityType.toLowerCase()}`,
        href: null,
      };
    }
    case "AI_MUTATION_DECLINED":
      return { label: "You declined the assistant's proposal", href: null };
    case "TASK_CREATED":
    case "EVENT_CREATED":
    case "NOTE_CREATED":
    case "GOAL_CREATED":
      return {
        label: `Created ${entry.entityType.toLowerCase()}`,
        href: `${ENTITY_HREF_PREFIX[entry.entityType]}/${entry.entityId}`,
      };
    default:
      return { label: entry.action, href: null };
  }
}

export default async function AuditPage() {
  const userId = await requireUserId();
  const entries = await listAuditTrail(userId, 100);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Audit log</h1>
        <p className="mt-1 text-sm text-text-muted">
          Every action the assistant proposed, and what happened to it — the most
          recent {entries.length} {entries.length === 1 ? "entry" : "entries"}.
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong px-4 py-10 text-center text-sm text-text-muted">
          Nothing recorded yet. Actions the assistant proposes — and whether you
          confirm or decline them — will show up here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => {
            const { label, href } = describe(entry);
            const body = (
              <>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      entry.actorType === "AI_AGENT"
                        ? "bg-accent-soft text-accent"
                        : "bg-surface-raised text-text-muted"
                    }`}
                  >
                    {ACTOR_LABEL[entry.actorType] ?? entry.actorType}
                  </span>
                  <span className="text-xs text-text-faint">
                    {new Intl.DateTimeFormat("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(entry.createdAt)}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm text-text">{label}</p>
              </>
            );

            return (
              <li key={entry.id}>
                {href ? (
                  <Link
                    href={href}
                    className="block rounded-xl border border-border-subtle bg-surface px-3.5 py-2.5 transition-colors hover:border-border-strong"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="rounded-xl border border-border-subtle bg-surface px-3.5 py-2.5">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
