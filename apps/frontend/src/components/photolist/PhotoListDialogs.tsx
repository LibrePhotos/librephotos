import type { PigPhoto } from "@librephotos/api-client";
import type { SelectionState } from "../../api_client/photos/types";
import { Lightbox } from "../lightbox/Lightbox";
import { AlbumCoverPickerModal } from "../modals/AlbumCoverPickerModal";
import { AlbumEditModal } from "../modals/AlbumEdit/AlbumEditModal";
import { ModalTagEdit } from "../modals/ModalTagEdit";
import { ModalAlbumShare } from "../sharing/ModalAlbumShare";
import { ModalPhotosShare } from "../sharing/ModalPhotosShare";
import type { PhotoListDialogState } from "./usePhotoListDialogs";
import type { PhotoListLightbox } from "./usePhotoListLightbox";

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
  publicAlbumSlug?: string;
  isPublic: boolean;
  isUserAlbum: boolean;
  albumID?: string;
  title: string;
  idx2hash: PigPhoto[];
  totalCount: number;
  selectionState: SelectionState;
  updateSelectionState: (state: Partial<SelectionState>) => void;
  onSelectCover: (photoId: string) => void;
}>;

// The lightbox and the modals a photo list opens. The add-to-album, tag and share modals clear the
// selection when they close; the cover picker sets the album cover.
export function PhotoListDialogs({
  dialogs,
  lightbox,
  publicAlbumSlug,
  isPublic,
  isUserAlbum,
  albumID,
  title,
  idx2hash,
  totalCount,
  selectionState,
  updateSelectionState,
  onSelectCover,
}: Props) {
  return (
    <>
      {lightbox.lightboxOpen && (
        <Lightbox
          isPublic={isPublic}
          publicAlbumSlug={publicAlbumSlug}
          idx2hash={toLightboxItems(idx2hash)}
          selectedImage={lightbox.lightboxImageId}
          onChangedIndex={lightbox.handleLightboxIndexChange}
          onCloseRequest={lightbox.closeLightbox}
          onImageChange={lightbox.handleLightboxImageChange}
        />
      )}
      {!isPublic && (
        <AlbumEditModal
          isOpen={dialogs.addToAlbum.opened}
          onRequestClose={() => {
            dialogs.addToAlbum.close();
            updateSelectionState({
              selectedItems: [],
              selectMode: false,
              selectAllMode: false,
              selectAllQuery: undefined,
            });
          }}
          selectedImages={selectionState.selectedItems}
          selectAllMode={selectionState.selectAllMode}
          selectAllQuery={selectionState.selectAllQuery}
          totalCount={totalCount}
        />
      )}
      {!isPublic && (
        <ModalTagEdit
          isOpen={dialogs.tag.opened}
          onRequestClose={() => {
            dialogs.tag.close();
            updateSelectionState({
              selectedItems: [],
              selectMode: false,
              selectAllMode: false,
              selectAllQuery: undefined,
            });
          }}
          selectedImages={selectionState.selectedItems}
          selectAllMode={selectionState.selectAllMode}
          selectAllQuery={selectionState.selectAllQuery}
          totalCount={totalCount}
        />
      )}
      {!isPublic && (
        <ModalPhotosShare
          isOpen={dialogs.sharePhotos.opened}
          onRequestClose={() => {
            dialogs.sharePhotos.close();
          }}
          selectedImageHashes={selectionState.selectedItems.map(i => i.image_hash)}
          selectAllMode={selectionState.selectAllMode}
          selectAllQuery={selectionState.selectAllQuery}
        />
      )}
      {!isPublic && isUserAlbum && (
        <ModalAlbumShare
          isOpen={dialogs.albumShare.opened}
          onRequestClose={() => {
            dialogs.albumShare.close();
          }}
          albumID={albumID ?? ""}
        />
      )}
      {!isPublic && dialogs.coverPickerAlbumType && (
        <AlbumCoverPickerModal
          isOpen={dialogs.coverPicker.opened}
          onRequestClose={() => {
            dialogs.coverPicker.close();
            dialogs.setCoverPickerAlbumType(null);
          }}
          photos={idx2hash}
          albumTitle={title}
          onSelectCover={onSelectCover}
        />
      )}
    </>
  );
}
