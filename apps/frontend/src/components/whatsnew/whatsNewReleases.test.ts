/**
 * #2305: releases.json is generated from the release posts (apps/docs/scripts/build-releases.mjs,
 * whose --check runs in the docs workflow). Here it must parse with the app's schema and be in the
 * order selectUnseen relies on.
 */
import { describe, expect, it } from "vitest";
import data from "./releases.json";
import { WHATS_NEW_RELEASES, WhatsNewData } from "./whatsNewReleases";

describe("releases.json", () => {
  it("parses with the What's new schema", () => {
    expect(WhatsNewData.safeParse(data).success).toBe(true);
    expect(WHATS_NEW_RELEASES.length).toBeGreaterThan(0);
  });

  it("lists the newest release first, each covering its own tag, with unique highlight ids", () => {
    const dates = WHATS_NEW_RELEASES.map(release => Date.parse(release.date));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    for (const release of WHATS_NEW_RELEASES) {
      expect(release.versions).toContain(release.release);
      const ids = release.highlights.map(item => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("links only to the docs site, and into the app only by path", () => {
    for (const release of WHATS_NEW_RELEASES) {
      expect(release.url).toMatch(/^https:\/\/docs\.librephotos\.com\//);
      for (const item of release.highlights) {
        expect(item.learn_more).toMatch(/^https:\/\/docs\.librephotos\.com\//);
        if (item.open_in_app !== undefined) expect(item.open_in_app).toMatch(/^\/(?!\/)/);
      }
    }
  });
});
