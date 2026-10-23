/** #2305: when the What's new card may load at all, from data the app already has. */
import { describe, expect, it } from "vitest";
import { cardMayShow } from "./whatsNewContext";
import { testUser } from "./whatsNewFixture.test-utils";

describe("cardMayShow", () => {
  it("says yes after an update the user has not seen", () => {
    expect(cardMayShow(testUser(), "1.4.0", true)).toBe(true);
  });

  it("says no once the user saw the running release", () => {
    expect(cardMayShow(testUser({ last_seen_release: "1.4.0" }), "1.4.0", true)).toBe(false);
  });

  it("says no on a development build or before the tag is known", () => {
    expect(cardMayShow(testUser(), "dev", true)).toBe(false);
    expect(cardMayShow(testUser(), undefined, true)).toBe(false);
    expect(cardMayShow(undefined, "1.4.0", true)).toBe(false);
  });

  it("says no when the user or the server turned it off", () => {
    expect(cardMayShow(testUser({ show_whats_new: false }), "1.4.0", true)).toBe(false);
    expect(cardMayShow(testUser(), "1.4.0", false)).toBe(false);
  });

  it("says no for a server too old to remember the card", () => {
    expect(cardMayShow(testUser(), "1.4.0", undefined)).toBe(false);
    expect(cardMayShow(testUser({ last_seen_release: undefined }), "1.4.0", true)).toBe(false);
  });
});
