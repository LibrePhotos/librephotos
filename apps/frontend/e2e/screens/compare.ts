import type { BrowserContext } from "@playwright/test";

type Images = { before: string; after: string; tolerance: number };

/**
 * Runs in a blank page: decodes both images with a canvas and returns the share of pixels (0 to 1)
 * where a colour channel moved by more than `tolerance`, or 1 when the sizes differ. Self-contained,
 * because Playwright sends only its source to the page.
 */
async function changedShareInPage({ before, after, tolerance }: Images): Promise<number> {
  const decode = async (base64: string) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/webp;base64,${base64}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("no 2d canvas to decode the screenshots with");
    }
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  };
  const [a, b] = await Promise.all([decode(before), decode(after)]);
  if (a.width !== b.width || a.height !== b.height) {
    return 1;
  }
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    changed += Number([0, 1, 2].some(c => Math.abs(a.data[i + c] - b.data[i + c]) > tolerance));
  }
  return changed / (a.width * a.height);
}

/**
 * Share of pixels that differ between two WebP images. Lossy WebP shifts colours a little from run
 * to run, so a channel has to move by more than `tolerance` (of 255) to count. Decodes in a new
 * blank page of `context`: the app's page may forbid data: URLs in its content security policy.
 */
export async function changedPixelShare(
  context: BrowserContext,
  before: Uint8Array,
  after: Uint8Array,
  tolerance = 24
): Promise<number> {
  const page = await context.newPage();
  try {
    return await page.evaluate(changedShareInPage, {
      before: Buffer.from(before).toString("base64"),
      after: Buffer.from(after).toString("base64"),
      tolerance,
    });
  } finally {
    await page.close();
  }
}
