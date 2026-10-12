/**
 * The reset confirm page reported every refusal as "link invalid or expired",
 * so a user whose new password the validators refused was sent for a new link
 * that failed the same way. A throttled request said nothing at all.
 */
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { passwordResetError } from "./passwordResetErrors";

vi.mock("../../service/notifications", () => ({ notification: new Proxy({}, { get: () => () => {} }) }));

const refused = (status: number, body: unknown) =>
  new ApiError("refused", status, null, "/auth/password/reset/confirm/", body);

const envelope = (code: string, message: string) => ({ errors: [{ field: "non_field_errors", message, code }] });

describe("passwordResetError", () => {
  it("passes on what the password validators said", () => {
    const error = refused(400, {
      errors: [{ field: "new_password", message: "This password is too short.", code: "weak_password" }],
    });

    expect(passwordResetError(error)).toEqual({ kind: "weakPassword", message: "This password is too short." });
  });

  it("recognises a bad link by its code", () => {
    expect(passwordResetError(refused(400, envelope("invalid_reset_link", "Invalid or expired reset link")))).toEqual({
      kind: "invalidLink",
    });
    expect(passwordResetError(refused(400, envelope("missing_parameters", "Missing parameters")))).toEqual({
      kind: "invalidLink",
    });
  });

  it("goes by the code, never by the message text", () => {
    // A message that is not one of the link refusals used to count as a weak
    // password; without the weak_password code it is a bad link.
    expect(passwordResetError(refused(400, envelope("invalid_reset_link", "Too common.")))).toEqual({
      kind: "invalidLink",
    });
    expect(passwordResetError(refused(400, { errors: [] }))).toEqual({ kind: "invalidLink" });
    expect(passwordResetError(refused(400, envelope("weak_password", "")))).toEqual({ kind: "invalidLink" });
  });

  it("tells a throttled request and an already reported 500 apart from the rest", () => {
    expect(passwordResetError(refused(429, { errors: [] }))).toEqual({ kind: "throttled" });
    expect(passwordResetError(refused(500, undefined))).toEqual({ kind: "reported" });
    expect(passwordResetError(new TypeError("Failed to fetch"))).toEqual({ kind: "other" });
  });
});
