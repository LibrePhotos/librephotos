import { describe, expect, it } from "vitest";
import { userIdFromAccessToken } from "../transport";

/** An unsigned JWT carrying `claims`; the decoder never checks the signature. */
function jwt(claims: Record<string, unknown>): string {
  return `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
}

describe("userIdFromAccessToken", () => {
  it("reads the string claim current servers send (simplejwt >= 5.5)", () => {
    expect(userIdFromAccessToken(jwt({ exp: 9999999999, user_id: "42" }))).toBe(42);
  });

  it("reads the number claim servers before simplejwt 5.5 sent", () => {
    expect(userIdFromAccessToken(jwt({ exp: 9999999999, user_id: 42 }))).toBe(42);
  });

  it("decodes base64url payloads with multibyte claims and no padding", () => {
    // "ü" and "~?" push the payload into the '-' and '_' characters of base64url.
    const token = jwt({ user_id: "7", name: "Jürgen ~?>", first_name: "ü" });
    expect(token.split(".")[1]).not.toMatch(/=/);
    expect(userIdFromAccessToken(token)).toBe(7);
  });

  it.each([
    ["no claim", { exp: 1 }],
    ["an empty string", { user_id: "" }],
    ["a non-numeric string", { user_id: "abc" }],
    ["a padded string", { user_id: " 1" }],
    ["a fraction", { user_id: "1.5" }],
    ["a negative number", { user_id: -1 }],
    ["zero", { user_id: 0 }],
    ["a non-integer number", { user_id: 1.5 }],
    ["a boolean", { user_id: true }],
    ["null", { user_id: null }],
  ])("returns null for %s", (_label, claims) => {
    expect(userIdFromAccessToken(jwt(claims))).toBeNull();
  });

  it.each([
    ["no token", null],
    ["an empty token", ""],
    ["a token without a payload", "header-only"],
    ["a payload that is not JSON", "a.bm90IGpzb24.c"],
    ["a payload that is not an object", `a.${Buffer.from("[1]").toString("base64url")}.c`],
  ])("returns null for %s", (_label, token) => {
    expect(userIdFromAccessToken(token)).toBeNull();
  });
});
