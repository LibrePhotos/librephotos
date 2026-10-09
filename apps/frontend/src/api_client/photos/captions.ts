import type { Photo } from "./types";

/**
 * Readers for a photo's `captions_json`: an object the backend fills as the
 * models run (`user_caption`, `im2txt`, `places365`, and `{ tags }` under each
 * tagging model's key). Its values are not checked by the schema, so each
 * reader takes only a value of the type it promises.
 */
type Captions = Photo["captions_json"];

/** The caption the owner wrote; "" when there is none. */
export function userCaptionOf(captions: Captions): string {
  const value = captions?.user_caption;
  return typeof value === "string" ? value : "";
}

/** The captioning model's suggestion (`im2txt`); undefined when there is none. */
export function generatedCaptionOf(captions: Captions): string | undefined {
  const value = captions?.im2txt;
  return typeof value === "string" ? value : undefined;
}

/** The tags `taggingModel` stored for the photo; undefined when it stored none. */
export function autoTagsOf(captions: Captions, taggingModel: string): string[] | undefined {
  const entry = captions?.[taggingModel];
  if (typeof entry !== "object" || entry === null || !("tags" in entry)) return undefined;
  const tags: unknown = entry.tags;
  return Array.isArray(tags) && tags.every((tag): tag is string => typeof tag === "string") ? tags : undefined;
}
