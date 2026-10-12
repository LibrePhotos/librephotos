/**
 * Files under `/media/` (thumbnails, originals, videos, face crops, download
 * archives): the one place in the web app that builds their URLs and fetches
 * them. They are not API calls: the backend serves them outside `/api` and
 * authorizes them by the session cookies, so a fetch sends credentials and
 * goes around the API client's token and 401 handling.
 *
 * The builders are the shared ones from @librephotos/api-client (mobile uses
 * the same paths) with this app's server address bound.
 */
import {
  bigThumbnailUrl,
  embeddedMediaUrl,
  faceUrl,
  photoUrl,
  squareThumbnailSmallUrl,
  squareThumbnailUrl,
  videoUrl,
  zipUrl,
} from "@librephotos/api-client";
import { ApiError } from "../apiError";
import { serverAddress, shareAddress } from "../urls";

/** Media URLs relative to this app's server address (same origin, cookies ride along). */
export const mediaUrl = {
  /** Small grid thumbnail, for tiles under ~250px. */
  squareThumbnailSmall: (imageHash: string) => squareThumbnailSmallUrl(serverAddress, imageHash),
  /** Standard grid thumbnail. */
  squareThumbnail: (imageHash: string) => squareThumbnailUrl(serverAddress, imageHash),
  /** The lightbox picture and video poster. */
  bigThumbnail: (imageHash: string) => bigThumbnailUrl(serverAddress, imageHash),
  /** The original file. */
  photo: (imageHash: string) => photoUrl(serverAddress, imageHash),
  /** A video's stream (`.mp4` only tells the browser the type; the server ignores it). */
  video: (imageHash: string) => videoUrl(serverAddress, imageHash),
  /** A motion photo's embedded clip. */
  embedded: (imageHash: string) => embeddedMediaUrl(serverAddress, imageHash),
  /** A face crop, by the file name of its stored image. */
  face: (fileName: string) => faceUrl(serverAddress, fileName),
  /** A finished download archive, by the name the download job returned. */
  zip: (fileName: string) => zipUrl(serverAddress, fileName),
};

/** Absolute media URLs for a link that leaves the app (copied or shared): the origin plus the subpath. */
export const shareMediaUrl = {
  photo: (imageHash: string) => photoUrl(shareAddress, imageHash),
};

/**
 * Fetch a media file with the session cookies. A response outside 2xx rejects
 * with an ApiError carrying its status, like an API call; no toast is shown.
 */
export async function fetchMedia(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, { ...init, credentials: "include" });
  if (!response.ok) {
    throw new ApiError(`Fetching ${url} failed with HTTP ${response.status}`, response.status, null, url);
  }
  return response;
}

/** What a HEAD request for a media file answered: its status and the server's `X-Media-Error` reason. */
export type MediaProbe = { status: number; mediaError: string | null };

/**
 * Ask for a media file's status without downloading it (HEAD). Any status
 * resolves, since telling them apart is the point; only a request that never
 * got an answer rejects.
 */
export async function probeMedia(url: string): Promise<MediaProbe> {
  const response = await fetch(url, { method: "HEAD", credentials: "include" });
  return { status: response.status, mediaError: response.headers.get("X-Media-Error") };
}
