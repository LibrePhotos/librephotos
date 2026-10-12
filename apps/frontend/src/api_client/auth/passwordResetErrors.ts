import { extractServerMessage } from "@librephotos/api-client";
import { ApiError } from "../api";

/**
 * Why a password-reset request failed, as far as the page has to tell the user.
 *
 * - `weakPassword`: the server's password validators refused the new password.
 *   The link is still good; `message` says what to change.
 * - `invalidLink`: the link was used already, expired or was mangled.
 * - `throttled`: too many reset requests (HTTP 429).
 * - `reported`: a 500, which api.ts already put on screen.
 * - `other`: anything else, the backend unreachable included.
 */
export type PasswordResetError =
  | { kind: "weakPassword"; message: string }
  | { kind: "invalidLink" }
  | { kind: "throttled" }
  | { kind: "reported" }
  | { kind: "other" };

export function passwordResetError(error: unknown): PasswordResetError {
  if (!(error instanceof ApiError)) {
    return { kind: "other" };
  }
  if (error.status === 500) {
    return { kind: "reported" };
  }
  if (error.status === 429) {
    return { kind: "throttled" };
  }
  if (error.status === 400) {
    // The confirm endpoint answers `weak_password` when the validators refuse
    // the new password, `invalid_reset_link` or `missing_parameters` otherwise.
    const message = extractServerMessage(error.body);
    return error.serverCode === "weak_password" && message
      ? { kind: "weakPassword", message }
      : { kind: "invalidLink" };
  }
  return { kind: "other" };
}
