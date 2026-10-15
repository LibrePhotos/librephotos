import { addUploadsToAlbum } from "../../api_client/upload";
import type { AlbumOutcome } from "./useUploadQueue";

/** A queued file the library already had, and the album it was dropped into. */
export type ExistingInAlbum = { itemId: string; albumId: number; photoId: string };

type FilingOutcome = { itemId: string; albumId: number; outcome: AlbumOutcome };

const groupByAlbum = (existing: ExistingInAlbum[]): Map<number, ExistingInAlbum[]> => {
  const groups = new Map<number, ExistingInAlbum[]>();
  existing.forEach(entry => groups.set(entry.albumId, [...(groups.get(entry.albumId) ?? []), entry]));
  return groups;
};

/** One request per album; the files go to the library only when it fails (locked, deleted, offline). */
const fileGroup = async (albumId: number, entries: ExistingInAlbum[]): Promise<FilingOutcome[]> => {
  const outcome: AlbumOutcome = await addUploadsToAlbum(
    albumId,
    entries.map(entry => entry.photoId)
  ).then(
    () => "added_existing",
    () => "library_only"
  );
  return entries.map(({ itemId }) => ({ itemId, albumId, outcome }));
};

/**
 * Adds the files an upload found already in the library to the albums they were dropped into
 * (#612), album by album, and says how each came out. The upload card shows the outcome; a failure
 * is no error, since the file is in the library either way.
 */
export async function fileExistingIntoAlbums(existing: ExistingInAlbum[]): Promise<FilingOutcome[]> {
  const results = await Promise.all(
    [...groupByAlbum(existing)].map(([albumId, entries]) => fileGroup(albumId, entries))
  );
  return results.flat();
}
