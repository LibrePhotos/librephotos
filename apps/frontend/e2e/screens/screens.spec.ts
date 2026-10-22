import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Locator, Page, PageScreenshotOptions, Route } from "@playwright/test";
import { devices, expect, test } from "@playwright/test";
import { changedPixelShare } from "./compare";
import { SHOTS_DAY, SHOTS_DIR, SHOTS_FILTER } from "./env";
import type { Device, ShotRun } from "./files";
import { budgetError, looksTheSame, selectShots, shotRuns } from "./files";
import type { ShotSpec } from "./manifest";
import { SHOTS } from "./manifest";
import { countOtherOrigins, waitForMaps } from "./maps";

/**
 * The screens run: one test per shot, theme and device (screens/manifest.ts), each in its own
 * browser context. Writes apps/docs/static/img/shots/<file>.webp unless the new shot looks the same
 * as the file it would replace; screens/docs-manifest.teardown.ts then writes manifest.json.
 */

const PIXEL_7 = devices["Pixel 7"];

// A phone shot at the Pixel 7's 2.625 device pixels per CSS pixel would not fit its 120 KB budget.
const DEVICE_OPTIONS = {
  desktop: { viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  phone: {
    viewport: PIXEL_7.viewport,
    userAgent: PIXEL_7.userAgent,
    deviceScaleFactor: 1.5,
    isMobile: true,
    hasTouch: true,
  },
} satisfies Record<Device, object>;

// Scrollbars differ per platform and notifications come and go; neither belongs in a shot.
const HIDE = [
  "* { scrollbar-width: none !important; }",
  "*::-webkit-scrollbar { display: none !important; }",
  ".mantine-Notifications-root { display: none !important; }",
].join("\n");

/** The Memories strip asks for today's memories; ask for the fixed day's instead. */
async function pinMemoriesDay(route: Route) {
  const url = new URL(route.request().url());
  url.searchParams.set("date", SHOTS_DAY);
  await route.continue({ url: url.toString() });
}

/** Waits until every image inside the viewport has loaded real pixels. */
async function waitForVisibleImages(page: Page) {
  await page.waitForFunction(() =>
    Array.from(document.images)
      .filter(image => {
        const box = image.getBoundingClientRect();
        return box.width > 0 && box.bottom > 0 && box.top < window.innerHeight;
      })
      .every(image => image.complete && image.naturalWidth > 0)
  );
}

async function openShot(page: Page, shot: ShotSpec) {
  const otherOrigins = countOtherOrigins(page, new URL(test.info().project.use.baseURL ?? "").origin);
  await page.clock.setFixedTime(`${SHOTS_DAY}T10:00:00Z`);
  await page.route("**/api/memories**", pinMemoriesDay);
  await page.goto(shot.route);
  await shot.prepare?.(page);
  await expect(shot.waitFor(page)).toBeVisible();
  // Pages of photos arrive after the first render, map tiles later still.
  await page.waitForLoadState("networkidle");
  await waitForMaps(page, otherOrigins);
  await waitForVisibleImages(page);
  // No hover state in the shot.
  await page.mouse.move(0, 0);
}

type ShotOptions = Pick<PageScreenshotOptions, "animations" | "caret" | "mask" | "style">;

function shootTarget(page: Page, shot: ShotSpec): Page | Locator {
  return shot.clip ? shot.clip(page) : page;
}

/**
 * Writes the shot, or keeps the old file when the two look the same, and says which with the share
 * of pixels that changed (a new file counts as all changed).
 */
async function save(context: BrowserContext, file: string, bytes: Uint8Array) {
  const share = fs.existsSync(file) ? await changedPixelShare(context, fs.readFileSync(file), bytes) : 1;
  const change = `${(share * 100).toFixed(2)} % of the pixels changed`;
  if (looksTheSame(share)) {
    return { type: "kept", change };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return { type: "written", change };
}

/**
 * Waits until two PNG shots in a row are the same: maps draw their tiles, and late pictures fade in,
 * after the network went quiet.
 */
async function waitUntilStill(target: Page | Locator, options: ShotOptions) {
  let previous: Buffer | undefined;
  await expect
    .poll(
      async () => {
        const shot = await target.screenshot({ ...options, type: "png" });
        const still = previous?.equals(shot) ?? false;
        previous = shot;
        return still;
      },
      { message: "waiting for the page to stop changing", intervals: [500], timeout: 30_000 }
    )
    .toBe(true);
}

async function takeShot(page: Page, run: ShotRun<ShotSpec>) {
  await openShot(page, run.shot);
  const target = shootTarget(page, run.shot);
  const options: ShotOptions = { animations: "disabled", caret: "hide", mask: run.shot.mask?.(page), style: HIDE };
  await waitUntilStill(target, options);
  const bytes = await target.screenshot({ ...options, type: "webp", quality: 80 });
  expect(budgetError(run.fileName, run.device, bytes.length), "size budget").toBeUndefined();
  const { type, change } = await save(page.context(), path.join(SHOTS_DIR, run.fileName), bytes);
  test.info().annotations.push({ type, description: `${run.fileName}: ${change}` });
}

for (const run of shotRuns(selectShots(SHOTS, SHOTS_FILTER))) {
  test.describe(run.fileName, () => {
    test.use({ ...DEVICE_OPTIONS[run.device], colorScheme: run.theme });

    test(`${run.shot.id}, ${run.device}, ${run.theme}`, async ({ page }) => {
      await takeShot(page, run);
    });
  });
}
