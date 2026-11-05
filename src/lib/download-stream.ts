// How a download leaves the server: one function the JSON export and the vault share.

import { AppError, toApiResponse } from "@/lib/api-response";

/** A refusal that is about the size of what was asked for is a 413; anything else that goes wrong before the first byte is a 500. */
export function errorStatus(error: unknown): number {
  return error instanceof AppError && error.code === "VALIDATION_ERROR" ? 413 : 500;
}

/**
 * A streamed attachment download. The first chunk is read before the `Response` exists, so a
 * failure there (an account that no longer exists, a database that is down, a vault too large for
 * a zip) is an ordinary JSON error and not a half-sent file. A failure after bytes are sent aborts
 * the download: the caller's chunks must be such that no prefix of them passes for the whole
 * (the JSON is unterminated, a zip has no end record). `no-store`: everything the person owns,
 * behind a session, and no cache, shared or private, keeps a copy.
 */
export async function downloadResponse(
  chunks: AsyncGenerator<Uint8Array | string, unknown, unknown>,
  file: { filename: string; contentType: string },
): Promise<Response> {
  let first: IteratorResult<Uint8Array | string, unknown>;
  try {
    first = await chunks.next();
  } catch (error) {
    return Response.json(toApiResponse(error), { status: errorStatus(error) });
  }

  const encoder = new TextEncoder();
  let pending: IteratorResult<Uint8Array | string, unknown> | null = first;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = pending ?? (await chunks.next());
      pending = null;
      if (next.done) controller.close();
      else controller.enqueue(typeof next.value === "string" ? encoder.encode(next.value) : next.value);
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
