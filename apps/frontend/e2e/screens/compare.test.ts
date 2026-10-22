import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { changedPixelShare } from "./compare";

/** A WebP screenshot of a 100 x 100 page: grey, with a red square of `square` pixels per side. */
async function picture(page: Page, square: number, width = 100): Promise<Uint8Array> {
  await page.setViewportSize({ width, height: 100 });
  await page.setContent(
    `<body style="margin:0;background:#808080"><div style="width:${square}px;height:${square}px;background:#f00"></div></body>`
  );
  return page.screenshot({ type: "webp", quality: 80 });
}

test.describe("changedPixelShare", () => {
  test("is 0 for the same picture and grows with the part that changed", async ({ page, context }) => {
    const plain = await picture(page, 0);
    expect(await changedPixelShare(context, plain, await picture(page, 0))).toBe(0);
    const share = await changedPixelShare(context, plain, await picture(page, 50));
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.3);
  });

  test("is 1 when the sizes differ", async ({ page, context }) => {
    expect(await changedPixelShare(context, await picture(page, 0), await picture(page, 0, 120))).toBe(1);
  });
});
