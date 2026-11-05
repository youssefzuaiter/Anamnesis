import { requireUserId } from "@/lib/session";
import { toApiResponse } from "@/lib/api-response";
import { downloadResponse, errorStatus } from "@/lib/download-stream";
import { streamVault, vaultPreflight } from "@/services/vault-service";

/**
 * The person's notes and their attachments as a zip of Markdown files that Obsidian opens, written
 * one entry at a time. The route takes no input at all (no query string, no body).
 */
export async function GET() {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (error) {
    return Response.json(toApiResponse(error), { status: 401 });
  }

  // Refuse what could not fit one zip before the first byte, not half way through a download.
  try {
    await vaultPreflight(userId);
  } catch (error) {
    return Response.json(toApiResponse(error), { status: errorStatus(error) });
  }

  const filename = `anamnesis-vault-${new Date().toISOString().slice(0, 10)}.zip`;
  return downloadResponse(streamVault(userId), { filename, contentType: "application/zip" });
}
