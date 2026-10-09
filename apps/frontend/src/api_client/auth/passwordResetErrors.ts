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

// What the confirm endpoint answers for a bad link. It sends every refusal as a
// 400 with a `message`; this tells the link refusals from the validators' text
// until it sends a `code` as well.
const LINK_REFUSALS = new Set(["Invalid or expired reset link", "Missing parameters"]);

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
    const body = (error.body ?? {}) as { code?: unknown; message?: unknown };
    const message = typeof body.message === "string" ? body.message : "";
    const weak = typeof body.code === "string" ? body.code === "weak_password" : !LINK_REFUSALS.has(message);
    return weak && message ? { kind: "weakPassword", message } : { kind: "invalidLink" };
  }
  return { kind: "other" };
}
