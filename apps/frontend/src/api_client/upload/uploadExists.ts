import { ApiError, endpoints, type UploadExistsResponse } from "@librephotos/api-client";
import { apiClient } from "../api";
import { notifyParseError } from "../parseErrors";

/**
 * Whether this user already has a file with this MD5 (the server keys uploads by MD5 plus user id),
 * and that photo's id. Called outside React Query, so an answer that does not parse is reported here.
 */
export async function uploadExists(md5: string, userId: number): Promise<UploadExistsResponse> {
  try {
    return await endpoints.uploadExists(apiClient, md5, userId);
  } catch (error) {
    notifyParseError(error);
    throw error;
  }
}

/**
 * Add photos the library already had to the album an upload went to (#612). Called outside React
 * Query by the upload queue, which reports the outcome on its card.
 */
export async function addUploadsToAlbum(albumId: number, photoIds: string[]): Promise<void> {
  try {
    await endpoints.addPhotosToUserAlbumById(apiClient, albumId, photoIds);
  } catch (error) {
    notifyParseError(error);
    throw error;
  }
}

/** The server would not file an upload into its album (deleted, someone else's, or locked). */
export function isUploadAlbumRefusal(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 400 &&
    (error.serverCode === "album_not_found" || error.serverCode === "album_locked")
  );
}
