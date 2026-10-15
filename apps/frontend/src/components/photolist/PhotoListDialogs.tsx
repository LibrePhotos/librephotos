import type { PigPhoto } from "@librephotos/api-client";
import type { SelectionState } from "../../api_client/photos/types";
import { Lightbox } from "../lightbox/Lightbox";
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
const toLightboxItems = (idx2hash: PigPhoto[]) =>
  idx2hash.map(item => ({
    id: item.id,
    image_hash: item.image_hash,
    type: item.type,
    isTemp: item.isTemp,
    date: item.date,
    location: item.location,
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
        <Lightbox
          isPublic={isPublic}
          publicAlbumSlug={publicAlbumSlug}
          idx2hash={lightbox.lightboxAloneItem ? [lightbox.lightboxAloneItem] : toLightboxItems(idx2hash)}
          selectedImage={lightbox.lightboxImageId}
          onChangedIndex={lightbox.handleLightboxIndexChange}
          onCloseRequest={slideshow.close}
          onImageChange={lightbox.handleLightboxImageChange}
          startSlideshow={slideshow.active}
        />
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
          selectedImageHashes={selectionState.selectedItems.map(i => i.image_hash)}
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
