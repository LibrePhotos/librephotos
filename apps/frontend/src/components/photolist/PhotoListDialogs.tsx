import type { PigPhoto } from "@librephotos/api-client";
import type { SelectionState } from "../../api_client/photos/types";
import { AlbumThreadContext } from "../lightbox/albumThread";
import { Lightbox } from "../lightbox/Lightbox";
import { videoStartOf } from "../lightbox/videoStart";
import { AlbumEditModal } from "../modals/AlbumEdit/AlbumEditModal";
import { ModalTagEdit } from "../modals/ModalTagEdit";
import { ModalAlbumShare } from "../sharing/ModalAlbumShare";
import { ModalPhotosShare } from "../sharing/ModalPhotosShare";
import type { PhotoListDialogState } from "./usePhotoListDialogs";
import type { PhotoListLightbox } from "./usePhotoListLightbox";
import type { PhotoListSlideshow } from "./usePhotoListSlideshow";

// The lightbox gets the fields it needs, not the whole tile. type lets public and shared views, which
// have no photo details, play videos; isTemp marks placeholders that have not loaded yet; date and
// location feed the details panel a non-owner sees (the server already leaves out what it may not share).
const toLightboxItems = (idx2hash: PigPhoto[], title: string) =>
  idx2hash.map(item => ({
    id: item.id,
    image_hash: item.image_hash,
    type: item.type,
    isTemp: item.isTemp,
    date: item.date,
    location: item.location,
    projection_type: item.projection_type,
    // A person's video opens where the person is (#2762). Only a person's photos carry the time,
    // and their title is the person's name.
    videoStart: videoStartOf(item.person_video_time, title),
  }));

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
  totalCount: number;
  selectionState: SelectionState;
  updateSelectionState: (state: Partial<SelectionState>) => void;
}>;

// The lightbox and the modals a photo list opens. The add-to-album, tag and share modals clear the
// selection when they close.
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
  totalCount,
  selectionState,
  updateSelectionState,
}: Props) {
  const closeAndClearSelection = (close: () => void) => {
    close();
    updateSelectionState({ selectedItems: [], selectMode: false, selectAllMode: false, selectAllQuery: undefined });
  };

  return (
    <>
      {lightbox.lightboxOpen && (
        // A user album's photos carry its comments and likes (#262).
        <AlbumThreadContext.Provider value={isUserAlbum ? albumID : undefined}>
          <Lightbox
            isPublic={isPublic}
            publicAlbumSlug={publicAlbumSlug}
            idx2hash={lightbox.lightboxAloneItem ? [lightbox.lightboxAloneItem] : toLightboxItems(idx2hash, title)}
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
          selectedImages={selectionState.selectedItems}
          selectAllMode={selectionState.selectAllMode}
          selectAllQuery={selectionState.selectAllQuery}
          totalCount={totalCount}
        />
      )}
      {!isPublic && (
        <ModalTagEdit
          isOpen={dialogs.tag.opened}
          onRequestClose={() => closeAndClearSelection(dialogs.tag.close)}
          selectedImages={selectionState.selectedItems}
          selectAllMode={selectionState.selectAllMode}
          selectAllQuery={selectionState.selectAllQuery}
          totalCount={totalCount}
        />
      )}
      {!isPublic && (
        <ModalPhotosShare
          isOpen={dialogs.sharePhotos.opened}
          onRequestClose={dialogs.sharePhotos.close}
          // Placeholder tiles that never loaded have no hash.
          selectedImageHashes={selectionState.selectedItems.filter(i => !i.isTemp).map(i => i.image_hash)}
          selectAllMode={selectionState.selectAllMode}
          selectAllQuery={selectionState.selectAllQuery}
          totalCount={totalCount}
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
