/**
 * #2305: which releases the What's new card shows. The list is newest first, so a release is found
 * by its tag, never by parsing versions.
 */
import { describe, expect, it } from "vitest";
import { MAX_SHOWN_RELEASES, releasesForMenu, selectUnseen, withHighlights, type WhatsNewViewer } from "./selectUnseen";
import { RELEASES } from "./whatsNewFixture.test-utils";

const viewer = (overrides: Partial<WhatsNewViewer> = {}): WhatsNewViewer => ({
  runningTag: "1.4.0",
  lastSeenRelease: "1.3.0",
  dateJoined: "2025-01-01T00:00:00Z",
  isAdmin: false,
  ...overrides,
});

const shownTags = (decision: ReturnType<typeof selectUnseen>) =>
  decision.kind === "show" ? decision.releases.map(release => release.release) : decision.kind;

describe("selectUnseen", () => {
  it("shows nothing on a development build or a tag the list does not have", () => {
    expect(selectUnseen(RELEASES, viewer({ runningTag: "dev" }))).toEqual({ kind: "nothing" });
    expect(selectUnseen(RELEASES, viewer({ runningTag: "" }))).toEqual({ kind: "nothing" });
    expect(selectUnseen(RELEASES, viewer({ runningTag: "2026w25" }))).toEqual({ kind: "nothing" });
  });

  it("shows nothing once the running release was seen, or a newer one (a downgrade)", () => {
    expect(selectUnseen(RELEASES, viewer({ lastSeenRelease: "1.4.0" }))).toEqual({ kind: "nothing" });
    expect(selectUnseen(RELEASES, viewer({ runningTag: "1.3.0", lastSeenRelease: "1.4.0" }))).toEqual({
      kind: "nothing",
    });
    // Another patch release of the same post.
    expect(selectUnseen(RELEASES, viewer({ runningTag: "1.0.2", lastSeenRelease: "1.0.1" }))).toEqual({
      kind: "nothing",
    });
  });

  it("shows the release after the one last seen", () => {
    const decision = selectUnseen(RELEASES, viewer());
    expect(decision.kind === "show" && decision.tag).toBe("1.4.0");
    expect(shownTags(decision)).toEqual(["1.4.0"]);
  });

  it("finds a release by any tag its post covers", () => {
    expect(shownTags(selectUnseen(RELEASES, viewer({ runningTag: "1.0.2", lastSeenRelease: "0.9.0" })))).toEqual([
      "1.0.0",
    ]);
  });

  it("shows several unseen releases newest first, at most three, skipping those with nothing to show", () => {
    expect(shownTags(selectUnseen(RELEASES, viewer({ lastSeenRelease: "1.1.0" })))).toEqual([
      "1.4.0",
      "1.3.0",
      "1.2.0",
    ]);
    // A release older than the bundled ones counts as seen long ago.
    const decision = selectUnseen(RELEASES, viewer({ lastSeenRelease: "2026w25" }));
    expect(decision.kind === "show" && decision.releases).toHaveLength(MAX_SHOWN_RELEASES);
  });

  it("remembers a new user's release without showing anything", () => {
    const decision = selectUnseen(RELEASES, viewer({ lastSeenRelease: "", dateJoined: "2026-10-20T08:00:00Z" }));
    expect(decision).toEqual({ kind: "markSeen", tag: "1.4.0" });
  });

  it("shows an existing user meeting the card for the first time only the running release", () => {
    expect(shownTags(selectUnseen(RELEASES, viewer({ lastSeenRelease: "" })))).toEqual(["1.4.0"]);
  });

  it("hides admin-only highlights from other users", () => {
    const decision = selectUnseen(RELEASES, viewer());
    const ids = decision.kind === "show" ? decision.releases[0]?.highlights.map(item => item.id) : [];
    expect(ids).toEqual(["edits", "many", "filters", "collections"]);
    const admin = selectUnseen(RELEASES, viewer({ isAdmin: true }));
    expect(admin.kind === "show" && admin.releases[0]?.highlights.map(item => item.id)).toContain("finish-upgrade");
  });

  it("remembers a release whose highlights are all for admins, for everyone else", () => {
    const releases = [RELEASES[1], RELEASES[3]].filter(item => item !== undefined);
    const onlyAdmin = releases.map((item, index) =>
      index === 0 ? { ...item, highlights: item.highlights.filter(h => h.audience === "admin") } : item
    );
    expect(selectUnseen(onlyAdmin, viewer({ runningTag: "1.3.0", lastSeenRelease: "1.2.0" }))).toEqual({
      kind: "markSeen",
      tag: "1.3.0",
    });
  });
});

describe("withHighlights", () => {
  it("keeps every highlight for an admin and drops releases with none", () => {
    expect(withHighlights(RELEASES, true).map(item => item.release)).not.toContain("1.2.1");
    expect(withHighlights(RELEASES, true)[1]?.highlights).toHaveLength(2);
  });
});

describe("releasesForMenu", () => {
  it("opens on the running release and the ones before it", () => {
    expect(releasesForMenu(RELEASES, "1.3.0", false).map(item => item.release)).toEqual(["1.3.0", "1.2.0", "1.1.0"]);
  });

  it("shows the newest releases on a development build", () => {
    expect(releasesForMenu(RELEASES, "dev", false).map(item => item.release)).toEqual(["1.4.0", "1.3.0", "1.2.0"]);
  });
});
