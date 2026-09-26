/**
 * Pure EXIF/file display formatting for the viewer's info sheet.
 *
 * Kept out of the components (and out of `format.ts`, which is app-wide date and
 * byte formatting) so the fiddly parts — which the web frontend gets wrong in
 * places — are unit-tested rather than eyeballed on a phone:
 *
 *  - The web's `FileInfoComponent` filters values by *string matching* on
 *    `"undefined"`, `"null"` and `"0 mm"` after it has already interpolated
 *    them. That drops a legitimately-named file containing "null" and keeps a
 *    `0` aperture. Here every field is checked before it becomes a string.
 *  - The web prints `height x width` for dimensions — transposed. Photos are
 *    described width-first everywhere else in the product, so this does too.
 */

/** A number that is present and meaningful (a `0` focal length is neither). */
function positive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function present(value: string | null | undefined): value is string {
  const trimmed = value?.trim();
  return !!trimmed && trimmed.toLowerCase() !== "null" && trimmed.toLowerCase() !== "undefined";
}

/** `ƒ / 2.8`, matching the web sidebar's glyph. */
export function formatAperture(fstop: number | null | undefined): string | null {
  return positive(fstop) ? `ƒ / ${fstop}` : null;
}

/** Shutter speed arrives pre-formatted from the backend (`1/250`). */
export function formatShutterSpeed(value: string | null | undefined): string | null {
  return present(value) ? value.trim() : null;
}

export function formatIso(iso: number | null | undefined): string | null {
  return positive(iso) ? `ISO${iso}` : null;
}

export function formatFocalLength(mm: number | null | undefined): string | null {
  return positive(mm) ? `${Math.round(mm)} mm` : null;
}

export function formatSubjectDistance(metres: number | null | undefined): string | null {
  return positive(metres) ? `${metres} m` : null;
}

export function formatDigitalZoom(ratio: number | null | undefined): string | null {
  // A ratio of exactly 1 means "no digital zoom" — noise, not information.
  return positive(ratio) && ratio !== 1 ? `${ratio}×` : null;
}

/** `4032 × 3024`. Width first (see the module note). */
export function formatDimensions(
  width: number | null | undefined,
  height: number | null | undefined
): string | null {
  return positive(width) && positive(height) ? `${width} × ${height}` : null;
}

/** `12.2 MP`, one decimal, dropped entirely below 0.1 MP. */
export function formatMegapixels(
  width: number | null | undefined,
  height: number | null | undefined
): string | null {
  if (!positive(width) || !positive(height)) return null;
  const mp = Math.round(((width * height) / 1_000_000) * 10) / 10;
  return mp >= 0.1 ? `${mp} MP` : null;
}

/**
 * The display filename: the last path segment of the photo's first path.
 * Handles both separators — LibrePhotos stores Windows paths verbatim.
 */
export function filenameFromPaths(paths: readonly string[] | null | undefined): string | null {
  const first = paths?.[0];
  if (!present(first)) return null;
  const segments = first.replace(/\\/g, "/").split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : null;
}

/** The directory the photo lives in (everything before the filename). */
export function directoryFromPaths(paths: readonly string[] | null | undefined): string | null {
  const first = paths?.[0];
  if (!present(first)) return null;
  const normalized = first.replace(/\\/g, "/");
  const cut = normalized.lastIndexOf("/");
  return cut > 0 ? normalized.slice(0, cut) : null;
}

export type CaptureSettings = {
  fstop: number | null;
  shutter_speed: string | null;
  iso: number | null;
  focal_length: number | null;
};

/**
 * The one-line capture summary under the camera name (`ƒ / 2.8 · 1/250 ·
 * 35 mm · ISO400`), with absent values dropped rather than rendered as gaps.
 */
export function captureSummary(photo: Partial<CaptureSettings>): string | null {
  const parts = [
    formatAperture(photo.fstop),
    formatShutterSpeed(photo.shutter_speed),
    formatFocalLength(photo.focal_length),
    formatIso(photo.iso),
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Scene labels the server derived from the photo, flattened from whichever
 * captioning model produced them. `places365` splits attributes from
 * categories; `siglip2` is a flat tag list.
 */
export type SceneLabels = { attributes: string[]; categories: string[]; tags: string[] };

export function sceneLabels(captionsJson: unknown): SceneLabels {
  const empty: SceneLabels = { attributes: [], categories: [], tags: [] };
  if (!captionsJson || typeof captionsJson !== "object") return empty;
  const json = captionsJson as Record<string, unknown>;
  const places = json.places365 as Record<string, unknown> | undefined;
  const siglip = json.siglip2 as Record<string, unknown> | undefined;
  return {
    attributes: stringArray(places?.attributes),
    categories: stringArray(places?.categories),
    tags: stringArray(siglip?.tags),
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** The user's own caption, or null. Empty strings are "no caption", not "". */
export function userCaption(captionsJson: unknown): string | null {
  if (!captionsJson || typeof captionsJson !== "object") return null;
  const value = (captionsJson as Record<string, unknown>).user_caption;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** The model-generated caption suggestion (web: the "AI suggestion" chip). */
export function suggestedCaption(captionsJson: unknown): string | null {
  if (!captionsJson || typeof captionsJson !== "object") return null;
  const value = (captionsJson as Record<string, unknown>).im2txt;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Colour for a face-match confidence dot, using the same thresholds the web
 * face dashboard uses so a face that looks "probably right" on one client looks
 * the same on the other.
 */
export function probabilityColor(probability: number | null | undefined): string {
  if (typeof probability !== "number") return "#9aa0a6";
  if (probability > 0.9) return "#22c55e";
  if (probability > 0.8) return "#84cc16";
  if (probability > 0.7) return "#eab308";
  if (probability > 0.6) return "#f97316";
  return "#ef4444";
}
