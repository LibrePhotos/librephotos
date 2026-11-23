import { describe, expect, it } from "vitest";
import { accessTokenClaims } from "./useAccessToken";

const base64Url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const token = (claims: object) => `${base64Url('{"alg":"HS256"}')}.${base64Url(JSON.stringify(claims))}.signature`;

describe("accessTokenClaims", () => {
  it("reads the claims the app uses from simplejwt's access token", () => {
    expect(accessTokenClaims(token({ user_id: "7", name: "Zoë", is_admin: true, exp: 1 }))).toEqual({
      user_id: "7",
      name: "Zoë",
      is_admin: true,
    });
  });

  it("reads a numeric user id from an older server", () => {
    expect(accessTokenClaims(token({ user_id: 3, name: "ann", is_admin: false }))?.user_id).toBe("3");
  });

  it("does not take a claim of the wrong type", () => {
    expect(accessTokenClaims(token({ user_id: "x", name: 5, is_admin: "yes" }))).toEqual({
      user_id: "",
      name: "",
      is_admin: false,
    });
  });

  it("is null for a value that is not a JWT", () => {
    expect(accessTokenClaims("not-a-token")).toBeNull();
    expect(accessTokenClaims("a.%%%.c")).toBeNull();
  });
});
