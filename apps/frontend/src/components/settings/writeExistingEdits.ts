import type { WriteTypeCount } from "@librephotos/api-client";
import type { ParseKeys, TFunction } from "i18next";

// The types of "Write metadata to files" (api/metadata/library_write.py WRITE_TYPES), as a sentence
// lists them and as the dialog names them. A type this app does not know yet is left out of both.
const TYPE_NAME_KEYS: Partial<Record<string, ParseKeys>> = {
  ratings: "settings.writeexisting.types.ratings",
  dates: "settings.writeexisting.types.dates",
  rotations: "settings.writeexisting.types.rotations",
  captions: "settings.writeexisting.types.captions",
  locations: "settings.writeexisting.types.locations",
  keywords: "settings.writeexisting.types.keywords",
  face_tags: "settings.writeexisting.types.face_tags",
};

const TYPE_LABEL_KEYS: Partial<Record<string, ParseKeys>> = {
  ratings: "settings.writeexisting.typecounts.ratings",
  dates: "settings.writeexisting.typecounts.dates",
  rotations: "settings.writeexisting.typecounts.rotations",
  captions: "settings.writeexisting.typecounts.captions",
  locations: "settings.writeexisting.typecounts.locations",
  keywords: "settings.writeexisting.typecounts.keywords",
  face_tags: "settings.writeexisting.typecounts.face_tags",
};

/** A type the job writes, with its label for the dialog. */
export type LabelledCount = { type: string; label: string; photos: number };

/** The types that have photos to write, labelled; unknown types are dropped. */
export function labelledCounts(counts: readonly WriteTypeCount[], t: TFunction): LabelledCount[] {
  return counts.flatMap(({ type, photos }) => {
    const key = TYPE_LABEL_KEYS[type];
    return key && photos > 0 ? [{ type, label: t(key), photos }] : [];
  });
}

/** The types with photos as the language lists things: "ratings, dates, and tags". */
export function listWrittenTypes(counts: readonly WriteTypeCount[], t: TFunction, language: string): string {
  const names = counts.flatMap(({ type, photos }) => {
    const key = TYPE_NAME_KEYS[type];
    return key && photos > 0 ? [t(key)] : [];
  });
  try {
    return new Intl.ListFormat(language, { type: "conjunction" }).format(names);
  } catch {
    // An unknown language tag
    return new Intl.ListFormat("en", { type: "conjunction" }).format(names);
  }
}
