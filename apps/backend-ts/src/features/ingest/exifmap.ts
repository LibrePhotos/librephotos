// PhotoMetadata.extract_exif_data (port of lp-ingest exifmap.rs): which tags
// are read and how each value lands on api_photo / api_photometadata
// (_apply_to_photo, _apply_to_metadata), with Python's type checks.
import { asFloat, asInt, fractionLimited, isNumber, truthy, valueStr, type PyValue } from "./pyfmt";

/** EXIF_TAGS, in EXIF_VALUE_NAMES order. */
export const EXIF_TAGS = [
  "File:FileSize",
  "EXIF:FNumber",
  "EXIF:FocalLength",
  "EXIF:ISO",
  "EXIF:ExposureTime",
  "EXIF:Model",
  "EXIF:LensModel",
  "ImageWidth",
  "ImageHeight",
  "EXIF:FocalLengthIn35mmFormat",
  "EXIF:SubjectDistance",
  "EXIF:DigitalZoomRatio",
  "QuickTime:Duration",
  "Rating",
  "EXIF:SubSecTimeOriginal",
  "EXIF:ImageNumber",
  "XMP:Subject",
  "IPTC:Keywords",
  "XMP:Description",
  "XMP:Description-*",
];

export type ExifValues = Map<string, PyValue | null>;

/** _assign_nonzero_number: a truthy number. */
const nonzeroNumber = (v: PyValue | null | undefined) => (v != null && isNumber(v) && truthy(v) ? v : null);
/** _assign_number: any number (0 too). */
const number = (v: PyValue | null | undefined) => (v != null && isNumber(v) ? v : null);
/** _assign_string: a non-empty string. */
const string = (v: PyValue | null | undefined) => (typeof v === "string" && v !== "" ? v : null);

/** _text_value. */
function textValue(v: PyValue | null | undefined): string | null {
  if (v == null || typeof v === "boolean") return null;
  let s: string;
  if (typeof v === "string") s = v;
  else if (isNumber(v)) s = valueStr(v);
  else return null;
  const t = s.trim();
  return t === "" ? null : t;
}

const truncateChars = (s: string, n: number) => [...s].slice(0, n).join("");

export interface PhotoUpdate {
  size: number | null;
  videoLength: string | null;
  rating: number | null;
  exifTimestampSubsec: string | null;
  imageSequenceNumber: number | null;
}

export interface MetadataUpdate {
  aperture: number | null;
  focalLength: number | null;
  iso: number | null;
  width: number | null;
  height: number | null;
  focalLength35mm: number | null;
  cameraModel: string | null;
  lensModel: string | null;
  rating: number | null;
  shutterSpeed: string | null;
  dateTakenSubsec: string | null;
  keywords: string[] | null;
  /** The file's description (applied unless the user edited the caption). */
  description: string | null;
}

const get = (v: ExifValues, tag: string) => v.get(tag) ?? null;

export function photoUpdate(v: ExifValues): PhotoUpdate {
  const subsec = get(v, "EXIF:SubSecTimeOriginal");
  const size = nonzeroNumber(get(v, "File:FileSize"));
  const dur = nonzeroNumber(get(v, "QuickTime:Duration"));
  const rating = number(get(v, "Rating"));
  const seq = number(get(v, "EXIF:ImageNumber"));
  return {
    size: size == null ? null : asInt(size),
    videoLength: dur == null ? null : valueStr(dur),
    rating: rating == null ? null : asInt(rating),
    exifTimestampSubsec: truthy(subsec) ? truncateChars(valueStr(subsec), 10) : null,
    imageSequenceNumber: seq == null ? null : asInt(seq),
  };
}

/** _merge_keywords: XMP:Subject + IPTC:Keywords, deduplicated, sorted. */
function mergeKeywords(values: (PyValue | null)[]): string[] {
  const set = new Set<string>();
  for (const v of values) {
    if (Array.isArray(v)) for (const i of v) set.add(typeof i === "string" ? i : valueStr(i));
    else if (typeof v === "string" && v !== "") set.add(v);
  }
  // Python sorts str by code point; JS sorts by UTF-16 unit, equal for the BMP.
  return [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function metadataUpdate(v: ExifValues): MetadataUpdate {
  const f = (tag: string) => {
    const x = nonzeroNumber(get(v, tag));
    return x == null ? null : asFloat(x);
  };
  const i = (tag: string) => {
    const x = nonzeroNumber(get(v, tag));
    return x == null ? null : asInt(x);
  };
  const exposure = nonzeroNumber(get(v, "EXIF:ExposureTime"));
  const subsec = get(v, "EXIF:SubSecTimeOriginal");
  const keywords = mergeKeywords([get(v, "XMP:Subject"), get(v, "IPTC:Keywords")]);
  const rating = number(get(v, "Rating"));
  return {
    aperture: f("EXIF:FNumber"),
    focalLength: f("EXIF:FocalLength"),
    iso: i("EXIF:ISO"),
    width: i("ImageWidth"),
    height: i("ImageHeight"),
    focalLength35mm: i("EXIF:FocalLengthIn35mmFormat"),
    cameraModel: string(get(v, "EXIF:Model")),
    lensModel: string(get(v, "EXIF:LensModel")),
    rating: rating == null ? null : asInt(rating),
    shutterSpeed: exposure == null ? null : fractionLimited(exposure, 1000n),
    dateTakenSubsec: truthy(subsec) ? truncateChars(valueStr(subsec), 10) : null,
    keywords: keywords.length ? keywords : null,
    description: textValue(get(v, "XMP:Description")) ?? textValue(get(v, "XMP:Description-*")),
  };
}
