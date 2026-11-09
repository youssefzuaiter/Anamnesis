import "server-only";
import { AppError } from "@/lib/api-response";
import { partialFailureMessage } from "@/lib/series-edit";

/**
 * A later occurrence that cannot be saved stops the run, after this one and some later ones were. The refusal keeps
 * its code and says what was already saved, so the person does not think nothing was. Anything that is not an
 * `AppError` (a database failure) is logged here, since it is turned into one.
 */
export function partialFailure(error: unknown, changed: number): AppError {
  if (error instanceof AppError) return new AppError(error.code, partialFailureMessage(error.message, changed));
  console.error("[ERROR] Unhandled:", error);
  return new AppError("INTEGRATION_ERROR", partialFailureMessage("Something went wrong.", changed));
}
