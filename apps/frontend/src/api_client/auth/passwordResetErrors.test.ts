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

describe("passwordResetError", () => {
  it("passes on what the password validators said", () => {
    const error = refused(400, { status: false, message: "This password is too short." });

    expect(passwordResetError(error)).toEqual({ kind: "weakPassword", message: "This password is too short." });
  });

  it("recognises a bad link", () => {
    expect(passwordResetError(refused(400, { status: false, message: "Invalid or expired reset link" }))).toEqual({
      kind: "invalidLink",
    });
    expect(passwordResetError(refused(400, { status: false }))).toEqual({ kind: "invalidLink" });
  });

  it("prefers a code from the server over the message", () => {
    expect(passwordResetError(refused(400, { code: "invalid_link", message: "anything" }))).toEqual({
      kind: "invalidLink",
    });
    expect(passwordResetError(refused(400, { code: "weak_password", message: "Too common." }))).toEqual({
      kind: "weakPassword",
      message: "Too common.",
    });
  });

  it("tells a throttled request and an already reported 500 apart from the rest", () => {
    expect(passwordResetError(refused(429, { errors: [] }))).toEqual({ kind: "throttled" });
    expect(passwordResetError(refused(500, undefined))).toEqual({ kind: "reported" });
    expect(passwordResetError(new TypeError("Failed to fetch"))).toEqual({ kind: "other" });
  });
});
