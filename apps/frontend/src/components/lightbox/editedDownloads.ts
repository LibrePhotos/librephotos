/**
 * Downloading an edited photo (photo editing): once its rendition is ready, the photo's full-size
 * URL answers the edited JPEG and `?original=1` the original file (to the owner only), so the owner
 * gets both, each under a name of its own. A photo without an edit downloads as it always did.
 */
import type { Photo } from "@librephotos/api-client";
import { mediaUrl } from "../../api_client/media/mediaUrl";

/** The original file itself, for an edited photo (the server honours it for the photo's owner only). */
export function originalFileUrl(imageHash: string): string {
  return `${mediaUrl.photo(imageHash)}?original=1`;
}

/**
 * Where a link labelled with the photo's file name points: the original file itself. For an edited
 * photo that takes `?original=1` (its owner's details are the only ones with `edit`); the plain
 * address answers the edit.
 */
export function originalHref(photo: Pick<Photo, "image_hash" | "edit">): string {
  const edited = photo.edit !== null && photo.edit !== undefined && photo.edit.rendition !== "none";
  return edited ? originalFileUrl(photo.image_hash) : mediaUrl.photo(photo.image_hash);
}

/** The original's file name: the last part of its first path; the hash when there is none. */
export function originalFileName(photo: Pick<Photo, "image_path" | "image_hash">): string {
  return photo.image_path[0]?.split(/[\\/]/).pop() || photo.image_hash;
}

/** The edited picture's file name: the original's name without its extension, "-edited.jpg" after it. */
export function editedFileName(photo: Pick<Photo, "image_path" | "image_hash">): string {
  const name = originalFileName(photo);
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}-edited.jpg`;
}

/** What the lightbox offers to download of an edited photo; null for a photo without an edit. */
export type EditedDownloads = Readonly<{
  original: Readonly<{ url: string; name: string }>;
  /** The edited JPEG, or why it is not there yet (rendering) or at all (failed). */
  edited: Readonly<{ kind: "ready"; url: string; name: string }> | Readonly<{ kind: "pending" | "failed" }>;
}>;

export function editedDownloads(photo: Pick<Photo, "image_path" | "image_hash" | "edit">): EditedDownloads | null {
  const edit = photo.edit;
  if (!edit || edit.rendition === "none") return null;
  const original = { url: originalFileUrl(photo.image_hash), name: originalFileName(photo) };
  switch (edit.rendition) {
    case "ready":
      return {
        original,
        edited: {
          kind: "ready",
          url: `${mediaUrl.photo(photo.image_hash)}?v=${edit.version}`,
          name: editedFileName(photo),
        },
      };
    case "pending":
    case "failed":
      return { original, edited: { kind: edit.rendition } };
  }
}
