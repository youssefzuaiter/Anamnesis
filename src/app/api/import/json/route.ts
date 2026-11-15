import { revalidatePath } from "next/cache";
import { AppError, fail, ok, toApiResponse } from "@/lib/api-response";
import { requireUserId } from "@/lib/session";
import { RESTORE_LIMITS } from "@/lib/restore";
import { checkUpload, readBody } from "@/lib/vault-upload";
import { runJsonRestore } from "@/services/restore-service";

const TOO_LARGE = `That file is over ${Math.round(RESTORE_LIMITS.maxBytes / 1_048_576)} MB, the most a restore takes.`;

/**
 * Restores from an Anamnesis JSON export: `POST /api/import/json?mode=preview` says what a restore would do
 * and writes nothing, `mode=apply` does it. The body is the file itself, not a form (a Server Action takes at
 * most 15 MB). The file is hostile data; see `runJsonRestore`. Same checks as the vault upload: a session, a
 * request from this app's own pages, a bounded body.
 */
export async function POST(request: Request) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (error) {
    return Response.json(toApiResponse(error), { status: 401 });
  }

  const check = checkUpload(request, RESTORE_LIMITS.maxBytes);
  if (!check.ok) {
    const message = check.status === 413 ? TOO_LARGE : check.message;
    return Response.json(fail(check.status === 403 ? "FORBIDDEN" : "VALIDATION_ERROR", message), { status: check.status });
  }

  const body = await readBody(request.body, RESTORE_LIMITS.maxBytes);
  if (!body.ok) {
    return body.reason === "empty"
      ? Response.json(fail("VALIDATION_ERROR", "Choose an export file to restore from."), { status: 400 })
      : Response.json(fail("VALIDATION_ERROR", TOO_LARGE), { status: 413 });
  }

  try {
    const outcome = await runJsonRestore(userId, body.bytes, { apply: check.mode === "apply" });
    if (!outcome.ok) return Response.json(fail("VALIDATION_ERROR", outcome.message), { status: 400 });
    if (check.mode === "apply") {
      for (const path of ["/", "/notes", "/tasks", "/calendar", "/projects", "/goals", "/courses", "/cards", "/references"]) {
        revalidatePath(path);
      }
    }
    return Response.json(ok(outcome.report));
  } catch (error) {
    return Response.json(toApiResponse(error), { status: error instanceof AppError && error.code === "VALIDATION_ERROR" ? 400 : 500 });
  }
}
