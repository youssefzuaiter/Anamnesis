import { revalidatePath } from "next/cache";
import { AppError, fail, ok, toApiResponse } from "@/lib/api-response";
import { requireUserId } from "@/lib/session";
import { ZIP_LIMITS } from "@/lib/zip";
import { checkUpload, readBody } from "@/lib/vault-upload";
import { runVaultImport } from "@/services/vault-service";

/**
 * Restores notes (and the attachments they list) from a vault zip: `POST /api/import/vault?mode=preview`
 * says what an import would do and writes nothing, `mode=apply` does it. The body is the zip itself,
 * not a form: a Server Action takes at most 15 MB, and a vault with PDFs is bigger. The file is
 * hostile data; see `runVaultImport`.
 */
export async function POST(request: Request) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (error) {
    return Response.json(toApiResponse(error), { status: 401 });
  }

  const check = checkUpload(request, ZIP_LIMITS.maxZipBytes);
  if (!check.ok) return Response.json(fail(check.status === 403 ? "FORBIDDEN" : "VALIDATION_ERROR", check.message), { status: check.status });

  const body = await readBody(request.body, ZIP_LIMITS.maxZipBytes);
  if (!body.ok) {
    return body.reason === "empty"
      ? Response.json(fail("VALIDATION_ERROR", "Choose a vault zip to import."), { status: 400 })
      : Response.json(fail("VALIDATION_ERROR", `That file is over ${Math.round(ZIP_LIMITS.maxZipBytes / 1_048_576)} MB, the most a vault upload takes.`), { status: 413 });
  }

  try {
    const report = await runVaultImport(userId, body.bytes, { apply: check.mode === "apply" });
    if (report.notes.created > 0) {
      revalidatePath("/notes");
      revalidatePath("/");
    }
    return Response.json(ok(report));
  } catch (error) {
    return Response.json(toApiResponse(error), { status: error instanceof AppError && error.code === "VALIDATION_ERROR" ? 400 : 500 });
  }
}
