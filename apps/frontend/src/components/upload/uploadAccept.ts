import type { Accept } from "react-dropzone";

/**
 * What the upload picker and the drop target take: every image and video MIME
 * type, plus the formats browsers often hand over with an empty `File.type`
 * (HEIC, JPEG XL and camera RAW, depending on browser and OS), matched by
 * extension. The server's `is_valid_media` is the real gate.
 *
 * The extensions sit under their own concrete MIME key on purpose: listed
 * under `image/*`, react-dropzone would accept only those extensions and drop
 * the wildcard.
 */
const UNTYPED_IMAGE_EXTENSIONS = [".heic", ".heif", ".hif", ".jxl", ".avif"];
// api/mime.py RAW_EXTENSIONS
const RAW_EXTENSIONS = [
  ".3fr",
  ".ari",
  ".arw",
  ".bay",
  ".cr2",
  ".cr3",
  ".crw",
  ".cs1",
  ".cxi",
  ".dcr",
  ".dng",
  ".eip",
  ".erf",
  ".fff",
  ".iiq",
  ".j6i",
  ".k25",
  ".kc2",
  ".kdc",
  ".mdc",
  ".mef",
  ".mfw",
  ".mos",
  ".mrw",
  ".nef",
  ".nrw",
  ".orf",
  ".pef",
  ".raf",
  ".raw",
  ".rw2",
  ".rwl",
  ".rwz",
  ".sr2",
  ".srf",
  ".srw",
  ".x3f",
];

export const UPLOAD_ACCEPT: Accept = {
  "image/*": [],
  "video/*": [],
  "image/x-dcraw": [...UNTYPED_IMAGE_EXTENSIONS, ...RAW_EXTENSIONS],
};
