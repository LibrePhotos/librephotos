import type { Photo } from "@librephotos/api-client";
import { useState } from "react";
import { useUpdatePhotoMutation } from "../../api_client/photos/hooks";

/** Only the hash is always there: a viewer who is not the owner may have no date. */
export type TimestampPhoto = Pick<Photo, "image_hash"> &
  Partial<Pick<Photo, "exif_timestamp" | "date_set_by_user" | "exif_timestamp_offset">>;

/** The body that puts a photo's date back as it was before the last change. */
type DateChange = { exif_timestamp: string | null };

/**
 * Editing a photo's date with Undo, shared by the lightbox's date row and the
 * photo page's title. The state belongs to one photo: its user remounts it
 * (a `key`) when the photo changes, or an editor left open would save (or
 * undo) this photo's date onto the next one.
 */
export function useTimestampEditor(photoDetail: TimestampPhoto) {
  const [editMode, setEditMode] = useState(false);
  // Set once a change is saved: what Undo sends.
  const [undo, setUndo] = useState<DateChange | null>(null);
  const { mutate: updatePhoto, isPending } = useUpdatePhotoMutation();
  const exifTimestamp = photoDetail.exif_timestamp ?? null;

  // The photo's date as it is now. A date read from the file is not one to put back: the user had
  // set none, so Undo removes the date set since (servers before #2280 do not say, Undo pins it).
  const currentChange = (): DateChange => ({
    exif_timestamp: photoDetail.date_set_by_user === false ? null : exifTimestamp,
  });

  // The query holds the date shown: the editor closes, and Undo appears, once the server took it.
  const save = (data: DateChange) => {
    const before = currentChange();
    updatePhoto(
      { id: photoDetail.image_hash, data },
      {
        onSuccess: () => {
          setUndo(before);
          setEditMode(false);
        },
      }
    );
  };

  const onUndo = () => {
    if (!undo) return;
    updatePhoto({ id: photoDetail.image_hash, data: undo }, { onSuccess: () => setUndo(null) });
  };

  return {
    exifTimestamp,
    /** The date was set by hand, so there is one to remove. */
    canRemove: photoDetail.date_set_by_user === true,
    editMode,
    open: () => setEditMode(true),
    close: () => setEditMode(false),
    canUndo: undo !== null,
    onUndo,
    isPending,
    save: (exif_timestamp: string) => save({ exif_timestamp }),
    remove: () => save({ exif_timestamp: null }),
  };
}

export type TimestampEditor = ReturnType<typeof useTimestampEditor>;
