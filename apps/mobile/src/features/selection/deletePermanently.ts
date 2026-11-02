import { endpoints, type ApiClient } from "@librephotos/api-client";
import type { AppDatabase } from "@/db/types";
import { deleteOwnedRemotePhotosByHash } from "@/db/writers";

export type DeletePermanentlyResult = {
  /** Photos the server deleted, files included. */
  deleted: number;
  /** Photos it refused: not in the trash on the server (yet), or not the user's. */
  notDeleted: number;
};

/**
 * Delete trashed photos for good, as the web's Trash does (`DELETE
 * /photosedit/delete/`, `usePurgeDeletedPhotosMutation`). The server only takes
 * the requester's photos that are in its trash; a photo trashed here offline and
 * not replayed yet comes back as not deleted.
 *
 * Online-only: there is no outbox kind for it, since the mirror cannot undo a
 * deletion the server then refuses. On success the deleted rows leave the mirror
 * at once; the caller still runs a delta sync, which brings the server's
 * tombstones for the same photos (and anything else that changed).
 */
export async function deletePhotosPermanently(
  client: ApiClient,
  db: AppDatabase,
  ownerId: number | null,
  imageHashes: string[]
): Promise<DeletePermanentlyResult> {
  const response = await endpoints.deletePhotos(client, imageHashes);
  const deleted = response.deleted ?? response.results ?? [];
  const notDeleted = response.not_deleted ?? imageHashes.filter((h) => !deleted.includes(h));
  if (ownerId != null) deleteOwnedRemotePhotosByHash(db, ownerId, deleted);
  return { deleted: deleted.length, notDeleted: notDeleted.length };
}
