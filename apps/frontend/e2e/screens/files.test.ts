import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { SHOTS_DIR } from "./env";
import type { ShotMeta } from "./files";
import {
  budgetError,
  docsManifest,
  fileReader,
  looksTheSame,
  selectShots,
  serializeDocsManifest,
  shotFileName,
  shotRuns,
  webpSize,
} from "./files";
import { SHOTS } from "./manifest";

/** A minimal RIFF/WEBP header with one chunk of `type` and the given payload from byte 20 on. */
function webp(type: string, payload: number[]): Uint8Array {
  const bytes = new Uint8Array(30 + payload.length);
  bytes.set(Buffer.from("RIFF"), 0);
  bytes.set(Buffer.from("WEBP"), 8);
  bytes.set(Buffer.from(type), 12);
  bytes.set(payload, 20);
  return bytes;
}

test.describe("shot files", () => {
  test("desktop keeps <id>-<theme>.webp, a phone shot is <id>-phone-<theme>.webp", () => {
    expect(shotFileName("timeline", "desktop", "dark")).toBe("timeline-dark.webp");
    expect(shotFileName("timeline", "phone", "light")).toBe("timeline-phone-light.webp");
  });

  test("a shot runs in both themes, on a phone only when it asks", () => {
    const runs = shotRuns([{ id: "a" }, { id: "b", phone: true }]).map(run => run.fileName);
    expect(runs).toEqual([
      "a-light.webp",
      "a-dark.webp",
      "b-light.webp",
      "b-dark.webp",
      "b-phone-light.webp",
      "b-phone-dark.webp",
    ]);
  });

  test("SHOTS picks shots by id and rejects unknown ids", () => {
    const shots = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(selectShots(shots, undefined)).toEqual(shots);
    expect(selectShots(shots, "")).toEqual(shots);
    expect(selectShots(shots, " c, a ")).toEqual([{ id: "a" }, { id: "c" }]);
    expect(() => selectShots(shots, "a,nope")).toThrow("SHOTS names unknown shot ids: nope");
  });

  test("size budgets: 200 KB desktop, 120 KB phone", () => {
    expect(budgetError("a-light.webp", "desktop", 200 * 1024)).toBeUndefined();
    expect(budgetError("a-light.webp", "desktop", 200 * 1024 + 1)).toBe(
      "a-light.webp is 201 KB, over the 200 KB desktop budget"
    );
    expect(budgetError("a-phone-dark.webp", "phone", 130_000)).toBe(
      "a-phone-dark.webp is 127 KB, over the 120 KB phone budget"
    );
  });

  test("a shot looks the same when at most 0.2 % of its pixels changed", () => {
    expect(looksTheSame(0)).toBe(true);
    expect(looksTheSame(0.002)).toBe(true);
    expect(looksTheSame(0.0021)).toBe(false);
  });
});

test.describe("webpSize", () => {
  test("reads lossy, lossless and extended headers", () => {
    // VP8: frame tag, start code 9d 01 2a, then 1600 and 1000 as 16-bit little endian.
    expect(webpSize(webp("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 0x40, 0x06, 0xe8, 0x03]))).toEqual({
      width: 1600,
      height: 1000,
    });
    // VP8L: signature 0x2f, then width - 1 (14 bits) and height - 1 (14 bits): 412 x 839.
    const bits = 411 | (838 << 14);
    expect(webpSize(webp("VP8L", [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, bits >>> 24]))).toEqual({
      width: 412,
      height: 839,
    });
    // VP8X: flags and reserved bytes, then 24-bit width - 1 and height - 1: 618 x 1259.
    expect(webpSize(webp("VP8X", [0, 0, 0, 0, 0x69, 0x02, 0, 0xea, 0x04, 0]))).toEqual({ width: 618, height: 1259 });
  });

  test("rejects anything else", () => {
    expect(() => webpSize(Buffer.from("not an image at all, not even close"))).toThrow("not a WebP file");
    expect(() => webpSize(webp("ALPH", []))).toThrow("not a WebP file");
  });

  test("reads the committed docs shots", () => {
    expect(webpSize(fs.readFileSync(path.join(SHOTS_DIR, "timeline-light.webp")))).toEqual({
      width: 1600,
      height: 1000,
    });
  });
});

test.describe("docs manifest", () => {
  const sized = (width: number, height: number) => webp("VP8X", [0, 0, 0, 0, width - 1, 0, 0, height - 1, 0, 0]);
  const files: Record<string, Uint8Array> = {
    "a-light.webp": sized(160, 100),
    "a-dark.webp": sized(160, 100),
    "a-phone-light.webp": sized(41, 83),
    "a-phone-dark.webp": sized(41, 83),
    "b-light.webp": sized(16, 10),
    "c-light.webp": sized(16, 10),
    "c-dark.webp": sized(16, 10),
    "c-phone-light.webp": sized(4, 8),
  };
  const read = (name: string) => files[name];

  test("lists the shots with both files, with sizes, release and phone size", () => {
    const shots: ShotMeta[] = [
      { id: "a", alt: "A", phone: true, release: "1.3.0" },
      { id: "b", alt: "B" },
      { id: "c", alt: "C", phone: true },
      { id: "d", alt: "D" },
    ];
    expect(docsManifest(shots, read)).toEqual([
      { id: "a", alt: "A", width: 160, height: 100, release: "1.3.0", phone: { width: 41, height: 83 } },
      { id: "c", alt: "C", width: 16, height: 10 },
    ]);
    expect(serializeDocsManifest([{ id: "c", alt: "C", width: 16, height: 10 }])).toBe(
      '[\n  {\n    "id": "c",\n    "alt": "C",\n    "width": 16,\n    "height": 10\n  }\n]\n'
    );
  });

  test("the committed manifest.json is what the screens run writes", () => {
    const committed = fs.readFileSync(path.join(SHOTS_DIR, "manifest.json"), "utf8").replace(/\r\n/g, "\n");
    expect(committed).toBe(serializeDocsManifest(docsManifest(SHOTS, fileReader(SHOTS_DIR))));
  });

  test("shot ids are unique kebab-case and every shot has alt text", () => {
    const ids = SHOTS.map(shot => shot.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const shot of SHOTS) {
      expect(shot.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(shot.alt.trim().length, shot.id).toBeGreaterThan(20);
    }
  });
});
