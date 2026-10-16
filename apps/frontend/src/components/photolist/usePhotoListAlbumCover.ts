import type { PigPhoto } from "@librephotos/api-client";
import {
  useSetEventCoverMutation,
  useSetPersonAlbumCoverMutation,
  useSetUserAlbumCoverMutation,
} from "../../api_client/albums/hooks";
import type { AlbumCoverType } from "./SelectionActions";

// Makes the one selected photo the album's cover, from the selection menu. Picking a cover
// without a selection is the album / person page's "⋮" (#2240).
export const usePhotoListAlbumCover = (albumID: string | undefined, selectedItems: PigPhoto[]) => {
  const setUserAlbumCover = useSetUserAlbumCoverMutation();
  const setPersonAlbumCover = useSetPersonAlbumCoverMutation();
  const setEventCover = useSetEventCoverMutation();

  return (actionType: AlbumCoverType) => {
    const [onlySelected] = selectedItems;
    // The menu item is off for any other count
    if (selectedItems.length !== 1 || !onlySelected) return;
    const id = `${albumID}`;
    switch (actionType) {
      case "person":
        setPersonAlbumCover.mutate({ id, cover_photo: onlySelected.image_hash });
        return;
      case "useralbum":
        setUserAlbumCover.mutate({ id, photo: onlySelected.id });
        return;
      case "event":
        setEventCover.mutate({ id, photo: onlySelected.id });
    }
  };
};
