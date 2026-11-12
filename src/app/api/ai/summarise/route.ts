import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUserId } from "@/lib/session";
import { toApiResponse } from "@/lib/api-response";
import { getNote } from "@/repositories/note-repository";
import { summariseNote } from "@/services/summary-service";
import { recordProposed } from "@/services/action-service";

/*
 * Summarise one of the caller's notes (ROADMAP 24), streamed as NDJSON because a long note takes a
 * while on a CPU: `progress` per section, then one `proposal` (recorded as proposed, saved only when
 * the person confirms it like any other), or one `error`. Nothing is written but the audit row.
 */

const bodySchema = z.object({ noteId: z.uuid() }).strict();

export async function POST(request: Request) {
  let userId: string;
  let noteId: string;
  try {
    userId = await requireUserId();
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Choose a note to summarise." } }, { status: 400 });
    }
    noteId = parsed.data.noteId;
    // Checked here, as a plain 404, so nothing streams for a note that is not the caller's own.
    if (!(await getNote(userId, noteId))) {
      return Response.json({ success: false, data: null, error: { code: "RESOURCE_NOT_FOUND", message: "That note does not exist." } }, { status: 404 });
    }
  } catch (error) {
    const body = toApiResponse(error);
    return Response.json(body, { status: body.error?.code === "AUTH_REQUIRED" ? 401 : 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      try {
        const result = await summariseNote(userId, noteId, {
          onProgress: (done, total) => send({ type: "progress", done, total }),
          signal: request.signal,
        });
        const proposalId = randomUUID();
        await recordProposed(userId, proposalId, result.proposal, "summary");
        send({ type: "proposal", proposalId, proposal: result.proposal, kept: result.kept, dropped: result.dropped });
      } catch (error) {
        send({ type: "error", error: toApiResponse(error).error });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
