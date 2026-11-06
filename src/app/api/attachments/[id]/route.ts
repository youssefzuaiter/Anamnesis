import { requireUserId } from "@/lib/session";
import { getAttachmentRow } from "@/repositories/attachment-repository";
import { getAttachment } from "@/lib/attachment-store";
import { contentDisposition } from "@/lib/content-disposition";

/**
 * Serves one attachment to its owner.
 *
 * `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` are
 * both deliberate: even though the stored types exclude anything executable,
 * serving user-supplied bytes inline from the app's own origin is a habit
 * worth not forming.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const row = await getAttachmentRow(userId, id);
  if (!row) return new Response("Not found", { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await getAttachment(row.storageKey);
  } catch {
    // The row survived but the file did not — report it missing rather than
    // failing as a server error.
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Length": String(row.byteSize),
      "Content-Disposition": contentDisposition(row.filename),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
