import { z } from "zod";
import { requireUserId } from "@/lib/session";
import { readSignature } from "@/services/signature-service";
import { contentDisposition } from "@/lib/content-disposition";

/**
 * Serves one of the caller's signatures as its PNG. The stored bytes were read as a PNG header on the way in and only that type is ever sent, with
 * `nosniff`; `?download=1` asks for a file instead of showing it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const found = await readSignature(userId, id);
  if (!found) return new Response("Not found", { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(found.bytes), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(found.bytes.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      ...(download ? { "Content-Disposition": contentDisposition(`${found.name}.png`) } : {}),
    },
  });
}
