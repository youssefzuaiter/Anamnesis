import { requireUserId } from "@/lib/session";
import { toApiResponse } from "@/lib/api-response";
import { downloadResponse } from "@/lib/download-stream";
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
  // whole it took about five times its size, and a 150 MB file did not fit a 192 MB heap). See
  // `downloadResponse` for what happens when it fails before and after the first byte: the
  // unterminated JSON can never be mistaken for a complete file.
  const filename = `nexus-export-${new Date().toISOString().slice(0, 10)}.json`;
  return downloadResponse(streamFullExport(userId), { filename, contentType: "application/json" });
}
