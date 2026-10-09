/**
 * The sharing pages showed avatar_url as sent, which is relative to the server,
 * so avatars broke on a deployment under a PUBLIC_URL subpath. The share dialogs
 * also read `avatar`, which non-admins never get, and showed the placeholder.
 */
import { describe, expect, it, vi } from "vitest";
import { avatarSrc } from "./avatarSrc";

vi.mock("../../api_client/apiClient", () => ({ serverAddress: "/librephotos" }));

describe("avatarSrc", () => {
  it("prefixes the server address", () => {
    expect(avatarSrc({ avatar_url: "/protected_media/avatars/alice.jpg" })).toBe(
      "/librephotos/protected_media/avatars/alice.jpg"
    );
  });

  it("falls back to the placeholder without an avatar", () => {
    expect(avatarSrc({ avatar_url: null })).toBe("/unknown_user.jpg");
    expect(avatarSrc({})).toBe("/unknown_user.jpg");
    expect(avatarSrc(undefined)).toBe("/unknown_user.jpg");
  });
});
