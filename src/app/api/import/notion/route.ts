import { revalidatePath } from "next/cache";
import { AppError, fail, ok, toApiResponse } from "@/lib/api-response";
import { requireUserId } from "@/lib/session";
import { ZIP_LIMITS } from "@/lib/zip";
import { checkUpload, readBody } from "@/lib/vault-upload";
import { parseChoices, runNotionImport } from "@/services/notion-service";

const TOO_LARGE = `That file is over ${Math.round(ZIP_LIMITS.maxZipBytes / 1_048_576)} MB, the most a Notion import takes. Export a smaller part of the workspace.`;

/**
 * Imports a Notion "Markdown & CSV" export: `POST /api/import/notion?mode=preview` says what an import would do and writes
 * nothing, `mode=apply` does it. `db=<database id>:<project|course|none>` (repeatable) says what each database becomes. The body is
 * the zip itself, not a form (a Server Action takes at most 15 MB). The file is hostile data; see `runNotionImport`.
 */
export async function POST(request: Request) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (error) {
    return Response.json(toApiResponse(error), { status: 401 });
  }

  const check = checkUpload(request, ZIP_LIMITS.maxZipBytes);
  if (!check.ok) {
    const message = check.status === 413 ? TOO_LARGE : check.message;
    return Response.json(fail(check.status === 403 ? "FORBIDDEN" : "VALIDATION_ERROR", message), { status: check.status });
  }

  const body = await readBody(request.body, ZIP_LIMITS.maxZipBytes);
  if (!body.ok) {
    return body.reason === "empty"
      ? Response.json(fail("VALIDATION_ERROR", "Choose the zip Notion exported."), { status: 400 })
      : Response.json(fail("VALIDATION_ERROR", TOO_LARGE), { status: 413 });
  }

  try {
    const choices = parseChoices(new URL(request.url).searchParams.getAll("db"));
    const report = await runNotionImport(userId, body.bytes, { apply: check.mode === "apply", choices });
    if (report.notes.created > 0) {
      for (const path of ["/", "/notes", "/projects", "/courses"]) revalidatePath(path);
    }
    return Response.json(ok(report));
  } catch (error) {
    return Response.json(toApiResponse(error), { status: error instanceof AppError && error.code === "VALIDATION_ERROR" ? 400 : 500 });
  }
}
