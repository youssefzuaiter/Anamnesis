import Link from "next/link";
import { requireUserId } from "@/lib/session";
import { listGraph } from "@/repositories/link-repository";
import { NoteGraph } from "@/components/note-graph";

export const metadata = { title: "Note graph · Anamnesis" };

export default async function NoteGraphPage() {
  const userId = await requireUserId();
  const { nodes, edges } = await listGraph(userId);

  return (
    <div className="mx-auto flex h-[calc(100vh-6rem)] max-w-5xl flex-col">
      <header className="mb-4">
        <Link
          href="/notes"
          className="text-sm text-text-muted transition-colors hover:text-text"
        >
          ← Notes
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-text">
          Note graph
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {nodes.length} {nodes.length === 1 ? "note" : "notes"} ·{" "}
          {edges.length} {edges.length === 1 ? "link" : "links"}. Drag a note
          to move it, click to open it.
        </p>
      </header>

      {nodes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong px-4 py-10 text-center text-sm text-text-muted">
          No notes yet.
        </p>
      ) : (
        <NoteGraph nodes={nodes} edges={edges} />
      )}
    </div>
  );
}
