import { ApiError, ResponseParseError } from "@librephotos/api-client";
import type { Mutation, MutationMeta } from "@tanstack/react-query";
import { notification } from "../service/notifications";

/** The options of a mutation hook whose callers may show a failure themselves. */
export type MutationErrorOptions = {
  /**
   * This caller reports a failure itself (a form error, a message in its dialog, its own toast),
   * so the QueryClient's generic "could not save" toast stays away.
   */
  reportsErrors?: boolean;
};

// The one place that writes and reads the flag, so a typo cannot silence a toast.
const ERROR_TOAST = "errorToast";

/** The `meta` a mutation hook passes on from its `MutationErrorOptions`. */
export function mutationErrorMeta({ reportsErrors = false }: MutationErrorOptions = {}): MutationMeta {
  return { [ERROR_TOAST]: !reportsErrors };
}

/** Whether someone other than the MutationCache already tells the user about this failure. */
function reportedElsewhere(error: unknown, mutation: Mutation<unknown, unknown, unknown>): boolean {
  // A schema mismatch has its own "please report" toast (notifyParseError).
  if (error instanceof ResponseParseError) return true;
  // The transport toasts a 500 and logs a 401 out.
  if (error instanceof ApiError && (error.status === 500 || error.status === 401)) return true;
  // The hook handles its failures (useCancelJobMutation, useSetPhotosCategoryMutation, ...).
  if (mutation.options.onError) return true;
  return mutation.options.meta?.[ERROR_TOAST] === false;
}

/**
 * The QueryClient's MutationCache `onError`: a failed save, edit or delete that nobody else
 * reports gets one toast with the server's message, so a refused change is never silent (#2222).
 */
export function reportMutationError(error: unknown, mutation: Mutation<unknown, unknown, unknown>): void {
  if (reportedElsewhere(error, mutation)) return;
  notification.saveFailed(error instanceof ApiError ? error.serverMessage : null);
}

/** The server's reason when a response says the saved edit did not reach the file (`write_error`, #2294). */
function writeErrorOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("write_error" in data)) return null;
  const { write_error: writeError } = data;
  return typeof writeError === "string" && writeError !== "" ? writeError : null;
}

/**
 * The QueryClient's MutationCache `onSuccess`: an edit that LibrePhotos saved but ExifTool could not
 * write to the file or its sidecar (face tags, a drawn face, a rotation) gets a warning with the
 * server's reason, whichever page the edit came from (#2564). The hook's "done" toast stays: the edit
 * itself did save.
 */
export function reportWriteError(data: unknown): void {
  const reason = writeErrorOf(data);
  if (reason !== null) notification.notWrittenToFile(reason);
}
