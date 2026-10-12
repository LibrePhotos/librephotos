import type { ParseKeys, TFunction } from "i18next";

// The backend's service names with a label; any other name (a service newer than this app) shows as it is.
const SERVICE_LABEL_KEYS: Partial<Record<string, ParseKeys>> = {
  image_similarity: "services.label_image_similarity",
  thumbnail: "services.label_thumbnail",
  face_recognition: "services.label_face_recognition",
  image_captioning: "services.label_image_captioning",
  exif: "services.label_exif",
  tags: "services.label_tags",
  ocr: "services.label_ocr",
};

/** A backend service name ("face_recognition") in words. */
export function serviceLabel(name: string, t: TFunction): string {
  const key = SERVICE_LABEL_KEYS[name];
  return key ? t(key) : name;
}
