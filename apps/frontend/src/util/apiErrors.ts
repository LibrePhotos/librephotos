import { ApiError } from "../api_client/api";
import { notification } from "../service/notifications";

/**
 * Report a failed user save.
 *
 * Only `serverMessage` is safe to show: a 500 or a 401 makes FetchClient raise
 * its own toast and throw an internal English string, so those fall back to the
 * translated generic message and a 401 stays silent entirely.
 */
export function reportUserSaveError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    return;
  }
  notification.updateUserError(error instanceof ApiError ? (error.serverMessage ?? undefined) : undefined);
}

/** Report a rejected sign-up; same rules as `reportUserSaveError`. */
export function reportSignupError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    return;
  }
  notification.signupError(error instanceof ApiError ? (error.serverMessage ?? undefined) : undefined);
}
