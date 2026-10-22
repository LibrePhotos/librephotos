import type { Page, Request } from "@playwright/test";
import { expect } from "@playwright/test";

/** Requests to other origins started and settled (finished or failed), and when the last one did either. */
export type RequestCounts = { started: number; settled: number; changedAt: number };

/** How long the map's requests have to stay settled: the style's sources start their tiles a moment later. */
const QUIET_MS = 1_500;

/**
 * Counts a page's requests to other origins than `origin`. Map styles and tiles come from a CDN,
 * fetched by MapLibre's worker after the page itself went quiet, so neither networkidle nor a page
 * that stopped changing for a moment proves that a map is drawn.
 */
export function countOtherOrigins(page: Page, origin: string): RequestCounts {
  const counts = { started: 0, settled: 0, changedAt: 0 };
  const other = (request: Request) => Number(new URL(request.url()).origin !== origin);
  const settle = (request: Request) => {
    counts.settled += other(request);
    counts.changedAt = Date.now();
  };
  page.on("request", request => {
    counts.started += other(request);
    counts.changedAt = Date.now();
  });
  page.on("requestfinished", settle);
  page.on("requestfailed", settle);
  return counts;
}

/**
 * With a map on the page, waits until it fetched from its CDN and no request to another origin has
 * been open for a moment.
 */
export async function waitForMaps(page: Page, counts: RequestCounts) {
  if ((await page.locator(".maplibregl-canvas").count()) === 0) {
    return;
  }
  await expect
    .poll(() => counts.settled > 0 && counts.settled === counts.started && Date.now() - counts.changedAt > QUIET_MS, {
      message: "waiting for the map tiles",
      timeout: 30_000,
    })
    .toBe(true);
}
