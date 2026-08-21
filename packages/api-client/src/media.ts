/**
 * Media URL builders. LibrePhotos serves image bytes from `<server>/media/...`
 * (NOT under `/api`). `serverAddress` is the bare server origin (no trailing
 * slash, no `/api`). The image hash for a grid item is `imageHashOf(pigPhoto)`.
 *
 * Auth: the web frontend relies on same-origin cookies for `/media/` requests.
 * React Native has no shared cookie jar with <Image>, so mobile passes an
 * `Authorization: Bearer <token>` header on the image request instead (see
 * `mediaHeaders`). Both approaches hit the same URLs.
 */

const MEDIA = {
  squareThumbnailSmall: "square_thumbnails_small",
  squareThumbnail: "square_thumbnails",
  bigThumbnail: "thumbnails_big",
  photo: "photos",
  embedded: "embedded_media",
  face: "faces",
} as const;

function join(serverAddress: string, ...parts: string[]): string {
  const base = serverAddress.replace(/\/+$/, "");
  return `${base}/media/${parts.join("/")}`;
}

/** Small grid thumbnail (rendered tile height < ~250px). */
export function squareThumbnailSmallUrl(serverAddress: string, imageHash: string): string {
  return join(serverAddress, MEDIA.squareThumbnailSmall, imageHash);
}

/** Standard/high-quality grid thumbnail. */
export function squareThumbnailUrl(serverAddress: string, imageHash: string): string {
  return join(serverAddress, MEDIA.squareThumbnail, imageHash);
}

/** Big thumbnail for the lightbox / detail view / video poster. */
export function bigThumbnailUrl(serverAddress: string, imageHash: string): string {
  return join(serverAddress, MEDIA.bigThumbnail, imageHash);
}

/** Full original photo / GIF. */
export function photoUrl(serverAddress: string, imageHash: string): string {
  return join(serverAddress, MEDIA.photo, imageHash);
}

/** Video stream (the `.mp4` suffix is cosmetic; backend strips the extension). */
export function videoUrl(serverAddress: string, imageHash: string): string {
  return `${join(serverAddress, MEDIA.photo, imageHash)}.mp4`;
}

/** Auth headers to attach to an image request on platforms without a cookie jar. */
export function mediaHeaders(accessToken: string | null): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}
