import { requireUserId } from "@/lib/session";
import { toApiResponse } from "@/lib/api-response";
import { streamFullExport } from "@/services/export-service";

export async function GET() {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (error) {
    const body = toApiResponse(error);
    return Response.json(body, { status: 401 });
  }

  // The file is written a page of rows at a time, so a large account never sits in memory (held
  // whole it took about five times its size, and a 150 MB file did not fit a 192 MB heap). The first
  // chunk is read before the response is built, so a failure there (an account that no longer
  // exists, a database that is down) is an ordinary JSON error and not a half-sent file.
  const chunks = streamFullExport(userId);
  let first: IteratorResult<string>;
  try {
    first = await chunks.next();
  } catch (error) {
    return Response.json(toApiResponse(error), { status: 500 });
  }

  const encoder = new TextEncoder();
  let pending: IteratorResult<string> | null = first;
  // A failure after bytes are sent aborts the download: the unterminated file is invalid JSON, so it
  // can never be mistaken for a complete one.
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = pending ?? (await chunks.next());
      pending = null;
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });

  const filename = `nexus-export-${new Date().toISOString().slice(0, 10)}.json`;
  return new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Everything the person owns, behind their session: no cache, shared or private, keeps a copy.
      "Cache-Control": "no-store",
    },
  });
}
