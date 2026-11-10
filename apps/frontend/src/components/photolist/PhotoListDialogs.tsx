import type { PigPhoto } from "@librephotos/api-client";
import { useMemo } from "react";
import { AlbumThreadContext } from "../lightbox/albumThread";
import { Lightbox } from "../lightbox/Lightbox";
import type { LightboxItem } from "../lightbox/lightbox.types";
import { videoStartOf } from "../lightbox/videoStart";
import { AlbumEditModal } from "../modals/AlbumEdit/AlbumEditModal";
import { ModalTagEdit } from "../modals/ModalTagEdit";
import { ModalAlbumShare } from "../sharing/ModalAlbumShare";
import { ModalPhotosShare } from "../sharing/ModalPhotosShare";
import type { Selected } from "./photoListSelection";
import type { PhotoListDialogState } from "./usePhotoListDialogs";
import type { PhotoListLightbox } from "./usePhotoListLightbox";
import type { PhotoListSlideshow } from "./usePhotoListSlideshow";

// The lightbox steps through the grid's own tiles: type lets public and shared views, which have no
// photo details, play videos; isTemp marks placeholders that have not loaded yet; date and location
// feed the details panel a non-owner sees (the server already leaves out what it may not share).
// Only a person's video gets a copy, with where the person is in it (#2762): only a person's photos
// carry the time, and their title is the person's name. Copying every tile cost a 200k-photo
// timeline about 10 MB per version of the list.
const toLightboxItems = (idx2hash: PigPhoto[], title: string): LightboxItem[] => {
  if (!idx2hash.some(item => typeof item.person_video_time === "number")) return idx2hash;
  return idx2hash.map(item =>
    typeof item.person_video_time === "number"
      ? { ...item, videoStart: videoStartOf(item.person_video_time, title) }
      : item
  );
};

type Props = Readonly<{
  dialogs: PhotoListDialogState;
  lightbox: PhotoListLightbox;
  slideshow: PhotoListSlideshow;
  publicAlbumSlug?: string;
  isPublic: boolean;
  isUserAlbum: boolean;
  albumID?: string;
  idx2hash: PigPhoto[];
  /** The list's title: on a person's page, the person's name. */
  title: string;
  selected: Selected;
  /** Ends select mode: after the add-to-album and tag modals. */
  onSelectionDone: () => void;
}>;

// The lightbox and the modals a photo list opens. The add-to-album and tag modals end select mode
// when they close.
export function PhotoListDialogs({
  dialogs,
  lightbox,
  slideshow,
  publicAlbumSlug,
  isPublic,
  isUserAlbum,
  albumID,
  idx2hash,
  title,
  selected,
  onSelectionDone,
}: Props) {
  // Mapped once per list, not on every render: a 200k-photo timeline is 200k new objects each time,
  // and the lightbox keeps stepping through the same array while the grid behind it refills.
  const { lightboxOpen, lightboxAloneItem } = lightbox;
  const lightboxItems = useMemo(() => {
    if (!lightboxOpen) return [];
    return lightboxAloneItem ? [lightboxAloneItem] : toLightboxItems(idx2hash, title);
  }, [lightboxOpen, lightboxAloneItem, idx2hash, title]);

  const closeAndClearSelection = (close: () => void) => {
    close();
    onSelectionDone();
  };

  return (
    <>
      {lightbox.lightboxOpen && (
        // A user album's photos carry its comments and likes (#262).
        <AlbumThreadContext.Provider value={isUserAlbum ? albumID : undefined}>
          <Lightbox
            isPublic={isPublic}
            publicAlbumSlug={publicAlbumSlug}
            idx2hash={lightboxItems}
            selectedImage={lightbox.lightboxImageId}
            onChangedIndex={lightbox.handleLightboxIndexChange}
            onCloseRequest={slideshow.close}
            onImageChange={lightbox.handleLightboxImageChange}
            startSlideshow={slideshow.active}
          />
        </AlbumThreadContext.Provider>
      )}
      {!isPublic && (
        <AlbumEditModal
          isOpen={dialogs.addToAlbum.opened}
          onRequestClose={() => closeAndClearSelection(dialogs.addToAlbum.close)}
          selection={selected}
        />
      )}
      {!isPublic && (
        <ModalTagEdit
          isOpen={dialogs.tag.opened}
          onRequestClose={() => closeAndClearSelection(dialogs.tag.close)}
          selection={selected}
        />
      )}
      {!isPublic && (
        <ModalPhotosShare
          isOpen={dialogs.sharePhotos.opened}
          onRequestClose={dialogs.sharePhotos.close}
          selection={selected}
        />
      )}
      {!isPublic && isUserAlbum && (
        <ModalAlbumShare
          isOpen={dialogs.albumShare.opened}
          onRequestClose={dialogs.albumShare.close}
          albumID={albumID ?? ""}
        />
      )}
    </>
  );
}
