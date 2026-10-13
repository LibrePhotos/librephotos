import type { ParseKeys, TFunction } from "i18next";

/** The choices of "Write edits to files" (`User.save_metadata_to_disk`). */
export type WriteMode = "OFF" | "SIDECAR_FILE" | "MEDIA_FILE";

/** The edits a user makes in LibrePhotos that could reach the photo's file. */
export type EditedField = "rating" | "date" | "rotation" | "caption" | "tags" | "location";

const EDITED_FIELDS: readonly EditedField[] = ["rating", "date", "rotation", "caption", "tags", "location"];

/**
 * Which edits each mode writes to the file, as the backend does today (`api/metadata/photo_writer.py`):
 * the rating, the capture date (`XMP:DateCreated`) and the rotation (`XMP-tiff:Orientation` in the
 * sidecar, the file's own EXIF orientation in a media file, #2550). Captions, tags and locations are
 * not written yet (#2289, #2290). Face names have their own switch and are not listed.
 *
 * The one list of written fields: the settings texts and the lightbox hints both read it, so add a
 * field here when the backend starts writing it.
 */
export const WRITTEN_FIELDS: Readonly<Record<WriteMode, readonly EditedField[]>> = {
  OFF: [],
  SIDECAR_FILE: ["rating", "date", "rotation"],
  MEDIA_FILE: ["rating", "date", "rotation"],
};

const FIELD_NAME_KEYS: Readonly<Record<EditedField, ParseKeys>> = {
  rating: "settings.writeedits.fields.rating",
  date: "settings.writeedits.fields.date",
  rotation: "settings.writeedits.fields.rotation",
  caption: "settings.writeedits.fields.caption",
  tags: "settings.writeedits.fields.tags",
  location: "settings.writeedits.fields.location",
};

/** The mode a stored value means; anything the app does not know writes nothing, like the server. */
export function writeModeOf(value: string): WriteMode {
  return value === "SIDECAR_FILE" || value === "MEDIA_FILE" ? value : "OFF";
}

/** Where an edit of `field` ends up besides LibrePhotos' own database. */
export type WriteDestination = "sidecar" | "file" | "none";

export function writeDestination(field: EditedField, mode: WriteMode): WriteDestination {
  if (!WRITTEN_FIELDS[mode].includes(field)) return "none";
  return mode === "SIDECAR_FILE" ? "sidecar" : "file";
}

/** The edits no mode writes yet. */
export function fieldsNeverWritten(): EditedField[] {
  const written = new Set(Object.values(WRITTEN_FIELDS).flat());
  return EDITED_FIELDS.filter(field => !written.has(field));
}

/** The fields as the language lists things: "ratings, dates, and rotations". */
export function listFields(fields: readonly EditedField[], t: TFunction, language: string): string {
  const names = fields.map(field => t(FIELD_NAME_KEYS[field]));
  try {
    return new Intl.ListFormat(language, { type: "conjunction" }).format(names);
  } catch {
    // An unknown language tag
    return new Intl.ListFormat("en", { type: "conjunction" }).format(names);
  }
}
