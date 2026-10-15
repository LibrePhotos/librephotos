import type { Photo } from "@librephotos/api-client";
import type { ParseKeys, TFunction } from "i18next";
import {
  formatAperture,
  formatDigitalZoom,
  formatDimensions,
  formatDuration,
  formatExposureBias,
  formatFocalLength,
  formatIso,
  formatMegapixels,
  formatShutterSpeed,
  formatSubjectDistance,
  formatVideoCodec,
} from "../../util/exifFormat";
import { formatFileSize } from "../../util/fileSize";

/**
 * The camera and file facts of a photo, built once for the two places that show
 * them: the lightbox's Details panel (rows) and the photo page's Camera and File
 * cards (cells). Both read their values and their order from here, so they
 * cannot drift apart (#2276).
 */

/** What the camera parts read; a public album passes fewer of them (absent = not shared). */
export type CameraPhoto = Partial<
  Pick<
    Photo,
    | "camera"
    | "lens"
    | "fstop"
    | "shutter_speed"
    | "iso"
    | "focal_length"
    | "focalLength35Equivalent"
    | "subjectDistance"
    | "digitalZoomRatio"
    | "exposure_compensation"
    | "flash_fired"
    | "metering_mode"
    | "white_balance"
  >
>;

/** One labelled value of the "Show more" list. */
export type DetailRow = { key: string; label: string; value: string };

export type CameraDetails = {
  camera: string | null;
  lens: string | null;
  aperture: string | null;
  shutter: string | null;
  /** `ISO 200` */
  iso: string | null;
  focalLength: string | null;
  /** The 35 mm equivalent focal length (`35 mm`), when the camera recorded one. */
  focal35: string | null;
  /** `+0.7 EV` */
  bias: string | null;
  /** Everything else the camera recorded, labelled: flash, white balance, metering, ... */
  more: DetailRow[];
};

// MeteringMode and WhiteBalance as the backend stores them (ExifTool's names, api/models/photo_metadata.py).
const METERING_KEYS: Partial<Record<string, ParseKeys>> = {
  Average: "exif.meteringmodes.average",
  "Center-weighted average": "exif.meteringmodes.centerweighted",
  Spot: "exif.meteringmodes.spot",
  "Multi-spot": "exif.meteringmodes.multispot",
  "Multi-segment": "exif.meteringmodes.multisegment",
  Partial: "exif.meteringmodes.partial",
  Other: "exif.meteringmodes.other",
};
const WHITE_BALANCE_KEYS: Partial<Record<string, ParseKeys>> = {
  Auto: "exif.whitebalances.auto",
  Manual: "exif.whitebalances.manual",
};

/** A stored name in the UI language; a name this app does not know (a sidecar's own) as it is. */
function named(value: string | null | undefined, keys: Partial<Record<string, ParseKeys>>, t: TFunction) {
  const trimmed = value?.trim();
  // "Unknown" metering says nothing.
  if (!trimmed || trimmed === "Unknown") return null;
  const key = keys[trimmed];
  return key ? t(key) : trimmed;
}

function flashText(fired: boolean | null | undefined, t: TFunction): string | null {
  if (fired == null) return null;
  return fired ? t("exif.flashfired") : t("exif.flashnotfired");
}

/** The labelled rest of the exposure, in the order a camera's info screen lists it. */
function moreRows(photo: CameraPhoto, t: TFunction, locale: string): DetailRow[] {
  const rows: [string, string, string | null][] = [
    ["flash", t("exif.flash"), flashText(photo.flash_fired, t)],
    ["whitebalance", t("exif.whitebalance"), named(photo.white_balance, WHITE_BALANCE_KEYS, t)],
    ["metering", t("exif.metering"), named(photo.metering_mode, METERING_KEYS, t)],
    ["distance", t("exif.subjectdistance"), formatSubjectDistance(photo.subjectDistance, locale)],
    ["zoom", t("exif.digitalzoomratio"), formatDigitalZoom(photo.digitalZoomRatio, locale)],
  ];
  return rows.flatMap(([key, label, value]) => (value ? [{ key, label, value }] : []));
}

export function cameraDetails(photo: CameraPhoto, t: TFunction, locale: string): CameraDetails {
  return {
    camera: photo.camera?.trim() || null,
    lens: photo.lens?.trim() || null,
    aperture: formatAperture(photo.fstop, locale),
    shutter: formatShutterSpeed(photo.shutter_speed, locale),
    iso: formatIso(photo.iso),
    focalLength: formatFocalLength(photo.focal_length, locale),
    focal35: formatFocalLength(photo.focalLength35Equivalent, locale),
    bias: formatExposureBias(photo.exposure_compensation, locale),
    more: moreRows(photo, t, locale),
  };
}

/** `23 mm (35 mm equiv.)`, or the focal length alone. */
function focalWithEquivalent(details: CameraDetails, t: TFunction): string | null {
  if (!details.focalLength) return null;
  // A 35 mm equivalent equal to the focal length is a full-frame camera's: it adds nothing.
  if (!details.focal35 || details.focal35 === details.focalLength) return details.focalLength;
  return t("exif.focalwithequivalent", { focal: details.focalLength, equivalent: details.focal35 });
}

function present(values: (string | null)[]): string[] {
  return values.filter((value): value is string => !!value);
}

/**
 * The panel's two rows, as on a camera's own info screen: the camera with what it
 * set (shutter, ISO, bias) and the lens with what it did (aperture, focal length).
 * Without a lens name, the lens values join the camera row.
 */
export function cameraRows(details: CameraDetails, t: TFunction): { camera: string[]; lens: string[] } {
  const lensValues = present([details.aperture, focalWithEquivalent(details, t)]);
  const cameraValues = present([details.shutter, details.iso, details.bias]);
  if (details.lens) return { camera: cameraValues, lens: lensValues };
  return {
    camera: present([details.aperture, details.shutter, focalWithEquivalent(details, t), details.iso, details.bias]),
    lens: [],
  };
}

/** What the file facts read. */
export type FilePhoto = Pick<Photo, "width" | "height" | "size" | "video"> &
  Partial<Pick<Photo, "video_length" | "video_codec">>;

/**
 * `6240 × 4160 · 26 MP · 8.4 MB`; a video `1920 × 1080 · 0:42 · H.264 · 96.2 MB`
 * (megapixels say little about a video). Absent facts are left out.
 */
export function fileFacts(photo: FilePhoto, locale: string): string[] {
  return present([
    formatDimensions(photo.width, photo.height),
    photo.video ? null : formatMegapixels(photo.width, photo.height, locale),
    photo.video ? formatDuration(photo.video_length) : null,
    photo.video ? formatVideoCodec(photo.video_codec) : null,
    photo.size > 0 ? formatFileSize(photo.size, locale) : null,
  ]);
}
