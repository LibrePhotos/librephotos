import type { PigPhoto } from "@librephotos/api-client";
import { useSetPersonAlbumCoverMutation, useSetUserAlbumCoverMutation } from "../../api_client/albums/hooks";
import type { AlbumCoverType } from "./SelectionActions";
import type { PhotoListDialogState } from "./usePhotoListDialogs";

// Sets the album cover from a photo list: the selected photo when exactly one is
// selected, otherwise the cover picker modal.
export const usePhotoListAlbumCover = (
  albumID: string | undefined,
  selectedItems: PigPhoto[],
  dialogs: PhotoListDialogState
) => {
  const setUserAlbumCover = useSetUserAlbumCoverMutation();
  const setPersonAlbumCover = useSetPersonAlbumCoverMutation();

  const setAlbumCover = (actionType: AlbumCoverType, photoId?: string) => {
    const onlySelected = selectedItems[0];
    // If photoId is provided (from modal), use it directly
    if (photoId) {
      if (actionType === "person") {
        setPersonAlbumCover.mutate({
          id: `${albumID}`,
          cover_photo: photoId,
        });
      }
      if (actionType === "useralbum") {
        setUserAlbumCover.mutate({
          id: `${albumID}`,
          photo: photoId,
        });
      }
      return;
    }

    // If exactly 1 item selected, use it
    if (selectedItems.length === 1 && onlySelected) {
      if (actionType === "person") {
        setPersonAlbumCover.mutate({
          id: `${albumID}`,
          cover_photo: onlySelected.image_hash,
        });
      }
      if (actionType === "useralbum") {
        setUserAlbumCover.mutate({
          id: `${albumID}`,
          photo: onlySelected.id,
        });
      }
    } else if (selectedItems.length === 0) {
      // No selection - open modal picker
      dialogs.setCoverPickerAlbumType(actionType);
      dialogs.coverPicker.open();
    }
    // Multiple selected: action is disabled at menu level
  };

  const onSelectCover = (photoId: string) => {
    if (dialogs.coverPickerAlbumType === "person") {
      setPersonAlbumCover.mutate({
        id: `${albumID}`,
        cover_photo: photoId,
      });
    }
    if (dialogs.coverPickerAlbumType === "useralbum") {
      setUserAlbumCover.mutate({
        id: `${albumID}`,
        photo: photoId,
      });
    }
  };

  return { setAlbumCover, onSelectCover };
};
