import fs from "node:fs";
import path from "node:path";

/**
 * File names, size budgets and the docs manifest of the screens run (playwright.screens.config.ts).
 * No browser in here, so screens/files.test.ts covers it without a running LibrePhotos.
 */
export type Theme = "light" | "dark";

export type Device = "desktop" | "phone";

export type ImageSize = { width: number; height: number };

/** What the docs need of a shot spec (screens/manifest.ts) to write its manifest.json entry. */
export type ShotMeta = { id: string; alt: string; phone?: boolean; release?: string };

/** One entry of apps/docs/static/img/shots/manifest.json, read by the docs `<Screenshot>` component. */
export type DocsShot = ImageSize & { id: string; alt: string; release?: string; phone?: ImageSize };

export const THEMES: readonly Theme[] = ["light", "dark"];

/** Desktop shots keep `<id>-<theme>.webp`, phone shots are `<id>-phone-<theme>.webp` (#2307). */
export function shotFileName(id: string, device: Device, theme: Theme): string {
  return device === "phone" ? `${id}-phone-${theme}.webp` : `${id}-${theme}.webp`;
}

/** The devices a shot is taken on: always desktop, a phone too when the spec asks. */
export function devicesOf(shot: { phone?: boolean }): Device[] {
  return shot.phone ? ["desktop", "phone"] : ["desktop"];
}

/** One screenshot to take: a shot spec on one device in one theme, and the file it goes to. */
export type ShotRun<T> = { shot: T; device: Device; theme: Theme; fileName: string };

export function shotRuns<T extends { id: string; phone?: boolean }>(shots: readonly T[]): ShotRun<T>[] {
  return shots.flatMap(shot =>
    devicesOf(shot).flatMap(device =>
      THEMES.map(theme => ({ shot, device, theme, fileName: shotFileName(shot.id, device, theme) }))
    )
  );
}

/** Largest file per device, in bytes (the media rules in .github/release-notes-template.md). */
export const SIZE_BUDGET: Readonly<Record<Device, number>> = { desktop: 200 * 1024, phone: 120 * 1024 };

/** Why a shot is too big for its budget, or undefined when it fits. */
export function budgetError(fileName: string, device: Device, bytes: number): string | undefined {
  const budget = SIZE_BUDGET[device];
  if (bytes <= budget) {
    return undefined;
  }
  return `${fileName} is ${Math.ceil(bytes / 1024)} KB, over the ${budget / 1024} KB ${device} budget`;
}

/**
 * The shots to take: every one, or the ids in `filter` (comma-separated, the SHOTS variable).
 * An id that is not in the manifest throws, so a typo does not silently take nothing.
 */
export function selectShots<T extends { id: string }>(shots: readonly T[], filter: string | undefined): T[] {
  const ids = (filter ?? "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean);
  const unknown = ids.filter(id => !shots.some(shot => shot.id === id));
  if (unknown.length > 0) {
    throw new Error(`SHOTS names unknown shot ids: ${unknown.join(", ")}`);
  }
  return ids.length === 0 ? [...shots] : shots.filter(shot => ids.includes(shot.id));
}

/** Whether a new screenshot looks the same as the file it would replace (screens/compare.ts measures). */
export function looksTheSame(changedShare: number, threshold = 0.002): boolean {
  return changedShare <= threshold;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function uint(bytes: Uint8Array, start: number, length: number): number {
  return bytes.subarray(start, start + length).reduceRight((value, byte) => value * 256 + byte, 0);
}

const SIZE_READERS: Readonly<Record<string, (bytes: Uint8Array) => ImageSize>> = {
  // Lossy: the frame header after the 9d 01 2a start code holds 14-bit width and height.
  "VP8 ": bytes => ({ width: uint(bytes, 26, 2) & 0x3fff, height: uint(bytes, 28, 2) & 0x3fff }),
  // Lossless: 14-bit width - 1 and height - 1, packed after the 0x2f signature.
  VP8L: bytes => {
    const bits = uint(bytes, 21, 4);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  },
  // Extended: 24-bit canvas width - 1 and height - 1.
  VP8X: bytes => ({ width: uint(bytes, 24, 3) + 1, height: uint(bytes, 27, 3) + 1 }),
};

/** The type of the first chunk of a WebP file ("VP8 ", "VP8L" or "VP8X"), or "" for anything else. */
function webpChunk(bytes: Uint8Array): string {
  const riff = bytes.length >= 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
  return riff ? ascii(bytes, 12, 16) : "";
}

/** Width and height of a WebP file, from its header. Throws for anything that is not WebP. */
export function webpSize(bytes: Uint8Array): ImageSize {
  const read = SIZE_READERS[webpChunk(bytes)];
  if (!read) {
    throw new Error("not a WebP file");
  }
  return read(bytes);
}

type ReadFile = (name: string) => Uint8Array | undefined;

/** Reads files of `dir` by name; undefined for a file that is not there. */
export function fileReader(dir: string): ReadFile {
  return name => {
    const file = path.join(dir, name);
    return fs.existsSync(file) ? fs.readFileSync(file) : undefined;
  };
}

/** Size of the light file of a pair, or undefined unless both files exist. */
function pairSize(read: ReadFile, id: string, device: Device): ImageSize | undefined {
  const [light, dark] = THEMES.map(theme => read(shotFileName(id, device, theme)));
  return light && dark ? webpSize(light) : undefined;
}

function docsEntry(shot: ShotMeta, desktop: ImageSize, phone: ImageSize | undefined): DocsShot {
  const entry: DocsShot = { id: shot.id, alt: shot.alt, ...desktop };
  if (shot.release) {
    entry.release = shot.release;
  }
  if (phone) {
    entry.phone = phone;
  }
  return entry;
}

/**
 * apps/docs/static/img/shots/manifest.json, in the order of the shot specs: one entry per spec whose
 * light and dark desktop files exist (`read` returns a file's bytes, or undefined when it is missing),
 * with the size of the light file, and the phone size when both phone files exist too.
 */
export function docsManifest(shots: readonly ShotMeta[], read: ReadFile): DocsShot[] {
  return shots.flatMap(shot => {
    const desktop = pairSize(read, shot.id, "desktop");
    const phone = shot.phone ? pairSize(read, shot.id, "phone") : undefined;
    return desktop ? [docsEntry(shot, desktop, phone)] : [];
  });
}

export function serializeDocsManifest(shots: readonly DocsShot[]): string {
  return `${JSON.stringify(shots, null, 2)}\n`;
}
