// What a line of the audit log says, and where it links. Pure, so each kind of entry is tested.

export type AuditLine = {
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
};

const ENTITY_HREF_PREFIX: Record<string, string> = {
  Task: "/tasks",
  Event: "/calendar",
  Note: "/notes",
  Goal: "/goals",
};

function field(value: unknown, ...path: string[]): unknown {
  let at = value;
  for (const key of path) {
    if (!at || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

const text = (value: unknown) => (typeof value === "string" ? value : null);
const href = (entry: AuditLine) => `${ENTITY_HREF_PREFIX[entry.entityType] ?? ""}/${entry.entityId}`;

export function auditLabel(entry: AuditLine): { label: string; href: string | null } {
  switch (entry.action) {
    case "AI_MUTATION_PROPOSED": {
      const kind = text(field(entry.metadata, "proposal", "kind"));
      const target = text(field(entry.metadata, "proposal", "targetTitle"));
      if (kind === "note_append") return { label: `Assistant proposed adding to the note "${target ?? ""}"`, href: null };
      if (kind === "task_reschedule") return { label: `Assistant proposed moving the task "${target ?? ""}"`, href: null };
      const title = text(field(entry.metadata, "proposal", "title"));
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
      return { label: `Created ${entry.entityType.toLowerCase()}`, href: href(entry) };
    case "NOTE_APPENDED": {
      const before = field(entry.metadata, "before", "length");
      const after = field(entry.metadata, "after", "length");
      const added = typeof before === "number" && typeof after === "number" ? after - before : null;
      return { label: added === null ? "Added to a note" : `Added ${added.toLocaleString("en")} characters to a note`, href: href(entry) };
    }
    case "TASK_RESCHEDULED":
      return { label: "Moved a task's due date", href: href(entry) };
    default:
      return { label: entry.action, href: null };
  }
}
