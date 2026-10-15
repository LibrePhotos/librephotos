/**
 * Camera and file values as the info panel and the photo page print them (#2276).
 *
 * Pure: every function takes the UI language as a BCP 47 tag (`i18nResolvedLanguage()`)
 * and formats numbers through `Intl.NumberFormat`, so German reads `ƒ/5,6` and
 * `+0,7 EV`. Each one returns null for a value that is missing or says nothing (a 0
 * aperture, a 0 EV bias, a zoom ratio of 1), so a caller never prints "null mm".
 * Ported from the mobile app's `features/viewer/exif.ts`.
 */

const formatters = new Map<string, Intl.NumberFormat>();

/** A cached formatter; an unknown language tag falls back to English rather than throwing. */
function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(locale, options);
    } catch {
      formatter = new Intl.NumberFormat("en", options);
    }
    formatters.set(key, formatter);
  }
  return formatter;
}

/** At most `digits` decimals, none printed for a whole number: 5.6, 26, 0.3. */
function decimal(value: number, locale: string, digits: number): string {
  return numberFormat(locale, { maximumFractionDigits: digits }).format(value);
}

/** A number that is present and meaningful (a 0 focal length is neither). */
function positive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** `ƒ/2.8`. */
export function formatAperture(fstop: number | null | undefined, locale: string): string | null {
  return positive(fstop) ? `ƒ/${decimal(fstop, locale, 1)}` : null;
}

/** ExifTool's PrintExposureTime: `1/N` up to 1/4 s, seconds with a unit above. */
function exposureSeconds(seconds: number, locale: string): string {
  if (seconds <= 0.25001) return `1/${Math.round(1 / seconds)}`;
  return `${decimal(seconds, locale, 1)} s`;
}

/**
 * A shutter speed as the backend stores it ("1/250", or seconds: "0.3", "2.5", "30"):
 * `1/250`, `2.5 s`. An older backend's improper fraction ("5/2") becomes `2.5 s`, and its
 * "0" (anything faster than 1/2000 s) says nothing, so it is left out.
 */
export function formatShutterSpeed(value: string | null | undefined, locale: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const fraction = /^(\d+)\/(\d+)$/.exec(trimmed);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (numerator === 0 || denominator === 0) return null;
    return numerator === 1 ? trimmed : exposureSeconds(numerator / denominator, locale);
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  const seconds = Number(trimmed);
  return seconds > 0 ? exposureSeconds(seconds, locale) : null;
}

/** `ISO 200`. Cameras print the number without grouping (`ISO 12800`). */
export function formatIso(iso: number | null | undefined): string | null {
  return positive(iso) ? `ISO ${Math.round(iso)}` : null;
}

/** `23 mm`, `6.8 mm` (a phone's lens). */
export function formatFocalLength(mm: number | null | undefined, locale: string): string | null {
  return positive(mm) ? `${decimal(mm, locale, 1)} mm` : null;
}

/** `+0.7 EV`, `-1.3 EV`; no bias (0) is left out. */
export function formatExposureBias(ev: number | null | undefined, locale: string): string | null {
  if (!finite(ev) || Math.abs(ev) < 0.05) return null;
  return `${numberFormat(locale, { maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(ev)} EV`;
}

/** `12.4 m`, `0.35 m`: three significant digits. */
export function formatSubjectDistance(metres: number | null | undefined, locale: string): string | null {
  return positive(metres) ? `${numberFormat(locale, { maximumSignificantDigits: 3 }).format(metres)} m` : null;
}

/** `1.5×`; a ratio of 1 means no digital zoom and is left out. */
export function formatDigitalZoom(ratio: number | null | undefined, locale: string): string | null {
  return positive(ratio) && ratio !== 1 ? `${decimal(ratio, locale, 1)}×` : null;
}

/** `6240 × 4160`, width first. */
export function formatDimensions(width: number | null | undefined, height: number | null | undefined): string | null {
  return positive(width) && positive(height) ? `${width} × ${height}` : null;
}

/** `26 MP`, `12.2 MP`; a picture too small to round to 0.1 MP says nothing. */
export function formatMegapixels(
  width: number | null | undefined,
  height: number | null | undefined,
  locale: string
): string | null {
  if (!positive(width) || !positive(height)) return null;
  const megapixels = (width * height) / 1_000_000;
  return megapixels >= 0.05 ? `${decimal(megapixels, locale, 1)} MP` : null;
}

/** Five decimals (about a metre), no digit grouping. */
function coordinate(value: number, locale: string): string {
  return numberFormat(locale, { minimumFractionDigits: 5, maximumFractionDigits: 5, useGrouping: false }).format(value);
}

/**
 * `37.08990, -8.41280` in the UI language. Where the decimal separator is a comma
 * (`37,08990`) the two are separated by a semicolon, so they still read as two numbers.
 */
export function formatCoordinates(
  lat: number | null | undefined,
  lon: number | null | undefined,
  locale: string
): string | null {
  if (!finite(lat) || !finite(lon)) return null;
  const separator = coordinate(0.5, locale).includes(",") ? "; " : ", ";
  return `${coordinate(lat, locale)}${separator}${coordinate(lon, locale)}`;
}

/** The coordinates to paste into a map or a search box: always `37.08990, -8.41280`. */
export function coordinatesForClipboard(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/** How far above or below sea level (`31 m`), rounded to the metre; 0 is sea level. */
export function formatAltitude(
  metres: number | null | undefined,
  locale: string
): { distance: string; belowSeaLevel: boolean } | null {
  if (!finite(metres)) return null;
  return { distance: `${decimal(Math.abs(metres), locale, 0)} m`, belowSeaLevel: metres < -0.5 };
}

/** A video's duration from its length in seconds ("42.042"): `0:42`, `1:02:03`. */
export function formatDuration(seconds: string | number | null | undefined): string | null {
  const total = Math.round(Number(seconds ?? Number.NaN));
  if (!Number.isFinite(total) || total <= 0) return null;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

const CODEC_NAMES: Partial<Record<string, string>> = {
  h264: "H.264",
  hevc: "HEVC",
  h265: "HEVC",
  av1: "AV1",
  vp8: "VP8",
  vp9: "VP9",
  mpeg4: "MPEG-4",
  mpeg2video: "MPEG-2",
  prores: "ProRes",
  mjpeg: "Motion JPEG",
};

/** A video codec as ffprobe names it ("h264", "hevc") the way people know it: `H.264`, `HEVC`. */
export function formatVideoCodec(codec: string | null | undefined): string | null {
  const name = codec?.trim().toLowerCase();
  if (!name) return null;
  return CODEC_NAMES[name] ?? name.toUpperCase();
}
