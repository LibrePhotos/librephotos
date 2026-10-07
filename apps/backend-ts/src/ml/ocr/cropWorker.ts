// Worker thread for OCR's text-box crops (PaddleOCR get_rotate_crop_image:
// a cv2-exact bicubic perspective warp, ~200 ns per output pixel in JS).
// The source image arrives once per photo as a SharedArrayBuffer; each crop
// goes back as a transferred buffer. Built to dist/ocr-crop-worker.js.
import type { IntQuad } from "./poly";
import { rotateCrop } from "./warp";

export type CropRequest =
  | { op: "image"; key: number; data: Uint8Array; w: number; h: number }
  | { op: "crop"; id: number; key: number; quad: IntQuad }
  | { op: "drop"; key: number };
export type CropReply = { id: number; ok: true; w: number; h: number; data: Uint8Array } | { id: number; ok: false; error: string };

declare const self: Worker;

if (typeof Bun !== "undefined" && !Bun.isMainThread) {
  const images = new Map<number, { w: number; h: number; data: Uint8Array }>();
  self.onmessage = (e: MessageEvent<CropRequest>) => {
    const m = e.data;
    if (m.op === "image") images.set(m.key, { w: m.w, h: m.h, data: m.data });
    else if (m.op === "drop") images.delete(m.key);
    else {
      try {
        const img = images.get(m.key);
        if (!img) throw new Error("ocr crop: image not sent");
        const c = rotateCrop(img, m.quad);
        self.postMessage({ id: m.id, ok: true, w: c.w, h: c.h, data: c.data } satisfies CropReply, [c.data.buffer as ArrayBuffer]);
      } catch (err) {
        self.postMessage({ id: m.id, ok: false, error: String(err) } satisfies CropReply);
      }
    }
  };
}
