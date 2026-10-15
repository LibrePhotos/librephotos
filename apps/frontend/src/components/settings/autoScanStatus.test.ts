/**
 * The automatic scan's status line (#235): what the last run did and when the next one is, with a
 * tone that is never the only signal.
 */
import type { SiteAutoScanStatus } from "@librephotos/api-client";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { autoScanStatusLine, isAutoScanFrequency } from "./autoScanStatus";

const t = i18n.t.bind(i18n);

function status(overrides: Partial<SiteAutoScanStatus> = {}): SiteAutoScanStatus {
  return {
    last_run_at: "2026-10-14T03:00:00Z",
    scanned: [],
    running: [],
    skipped: [],
    failed: [],
    next_run_at: null,
    time_zone: "UTC",
    ...overrides,
  };
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("autoScanStatusLine", () => {
  it("says there was no run yet, and when the first one is", () => {
    const line = autoScanStatusLine(status({ last_run_at: null, next_run_at: "2026-10-15T03:00:00Z" }), t);
    expect(line.tone).toBe("idle");
    expect(line.text).toMatch(/^No run yet\. Next run .+\.$/);
  });

  it("counts the libraries a run scanned", () => {
    const line = autoScanStatusLine(status({ scanned: ["anna"] }), t);
    expect(line.tone).toBe("ok");
    expect(line.text).toMatch(/^Last run .+: 1 library scanned\.$/);
    expect(autoScanStatusLine(status({ scanned: ["anna", "bob"] }), t).text).toContain("2 libraries scanned.");
  });

  it("says when nobody has a library", () => {
    expect(autoScanStatusLine(status(), t).text).toContain("no user has a library to scan.");
  });

  it("names whom a run is still scanning, skipped or could not scan, the worst setting the tone", () => {
    const running = autoScanStatusLine(status({ scanned: ["anna"], running: ["bob"] }), t);
    expect(running.tone).toBe("running");
    expect(running.text).toContain("1 library scanned. Still scanning: bob.");

    const skipped = autoScanStatusLine(status({ running: ["bob"], skipped: ["anna", "carla"] }), t);
    expect(skipped.tone).toBe("skipped");
    expect(skipped.text).toContain("Skipped anna, carla: a scan was still running.");

    const failed = autoScanStatusLine(status({ skipped: ["anna"], failed: ["bob"] }), t);
    expect(failed.tone).toBe("failed");
    expect(failed.text).toContain("Could not scan bob; see Worker Logs.");
  });
});

describe("isAutoScanFrequency", () => {
  it("knows the four frequencies only", () => {
    expect(["off", "hourly", "daily", "custom"].every(isAutoScanFrequency)).toBe(true);
    expect(isAutoScanFrequency("weekly")).toBe(false);
    expect(isAutoScanFrequency(undefined)).toBe(false);
  });
});
