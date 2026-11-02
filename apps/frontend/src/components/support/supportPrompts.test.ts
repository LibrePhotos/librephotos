import type { ProcessingStatus, SiteSettings } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import { testUser } from "../whatsnew/whatsNewFixture.test-utils";
import {
  asksForSupport,
  libraryReady,
  rewindSeasonYear,
  rewindToOpen,
  rewindWorthShowing,
  thankYouPending,
} from "./supportPrompts";

type Stage = ProcessingStatus["stages"][number];

function stage(overrides: Partial<Stage> = {}): Stage {
  return { key: "thumbnails", remaining: 0, unmatched: 0, running_job: null, last_run: null, ...overrides };
}

const lastRun = { job_id: "1", finished_at: "2026-11-01T00:00:00Z", failed: false, error_count: 2 };
type Switches = Pick<SiteSettings, "support_prompts_enabled" | "rewind_enabled">;
const settings = (overrides: Partial<Switches> = {}): Switches => ({
  support_prompts_enabled: true,
  rewind_enabled: true,
  ...overrides,
});

describe("libraryReady", () => {
  it("waits for photos and for every stage", () => {
    expect(libraryReady(undefined)).toBe(false);
    expect(libraryReady({ photo_count: 0, stages: [stage()] })).toBe(false);
    expect(libraryReady({ photo_count: 5, stages: [stage(), stage({ key: "places" })] })).toBe(true);
  });

  it("is not ready while a stage's job is queued or running", () => {
    const running = stage({ running_job: { job_id: "2", progress_current: 1, progress_target: 9 } });
    expect(libraryReady({ photo_count: 5, stages: [running] })).toBe(false);
  });

  it("counts a stage that ran but left photos it could not do as done, and one that never ran as not", () => {
    expect(libraryReady({ photo_count: 5, stages: [stage({ remaining: 2, last_run: lastRun })] })).toBe(true);
    expect(libraryReady({ photo_count: 5, stages: [stage({ remaining: 2 })] })).toBe(false);
  });
});

describe("the thank-you dialog", () => {
  const admin = testUser({ is_superuser: true, support_prompt_seen: false });

  it("is pending for an admin who has not seen it", () => {
    expect(thankYouPending(admin, settings())).toBe(true);
  });

  it("is never for a user, a seen dialog, a server that turned it off or an older server", () => {
    expect(thankYouPending(testUser({ support_prompt_seen: false }), settings())).toBe(false);
    expect(thankYouPending(testUser({ is_superuser: true, support_prompt_seen: true }), settings())).toBe(false);
    expect(thankYouPending(admin, settings({ support_prompts_enabled: false }))).toBe(false);
    expect(thankYouPending(testUser({ is_superuser: true }), settings())).toBe(false);
    expect(asksForSupport(admin, settings({ support_prompts_enabled: undefined }))).toBe(false);
  });
});

describe("Rewind's season", () => {
  it("runs from 20 December to 6 January", () => {
    expect(rewindSeasonYear(new Date(2026, 11, 19))).toBeNull();
    expect(rewindSeasonYear(new Date(2026, 11, 20))).toBe(2026);
    expect(rewindSeasonYear(new Date(2026, 11, 31))).toBe(2026);
    expect(rewindSeasonYear(new Date(2027, 0, 6))).toBe(2026);
    expect(rewindSeasonYear(new Date(2027, 0, 7))).toBeNull();
    expect(rewindSeasonYear(new Date(2026, 6, 1))).toBeNull();
  });

  it("opens once per year by itself", () => {
    const christmas = new Date(2026, 11, 24);
    expect(rewindToOpen(testUser({ rewind_seen_year: 0 }), settings(), christmas)).toBe(2026);
    expect(rewindToOpen(testUser({ rewind_seen_year: 2025 }), settings(), christmas)).toBe(2026);
    expect(rewindToOpen(testUser({ rewind_seen_year: 2026 }), settings(), christmas)).toBeNull();
  });

  it("never when the server turned it off or cannot remember it", () => {
    const christmas = new Date(2026, 11, 24);
    expect(rewindToOpen(testUser({ rewind_seen_year: 0 }), settings({ rewind_enabled: false }), christmas)).toBeNull();
    expect(rewindToOpen(testUser(), settings(), christmas)).toBeNull();
  });

  it("is worth showing with ten photos or videos", () => {
    const rewind = (photos: number, videos: number) => ({ photo_count: photos, video_count: videos });
    expect(rewindWorthShowing(undefined)).toBe(false);
    expect(rewindWorthShowing(rewind(8, 1))).toBe(false);
    expect(rewindWorthShowing(rewind(8, 2))).toBe(true);
  });
});
