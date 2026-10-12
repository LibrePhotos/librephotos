import { useDisclosure, useHotkeys } from "@mantine/hooks";
import { useState } from "react";
import type { RefObject } from "react";
import type { SelectionState } from "../../api_client/photos/types";
import type { AlbumCoverType } from "./SelectionActions";

// The modals a photo list opens from its toolbar, its selection bar and the keyboard.
// One place owns their open state, so every opener and the modal agree on it.
export const usePhotoListDialogs = (isPublic: boolean, selectionStateRef: RefObject<SelectionState>) => {
  const [modalAddToAlbumOpen, { open: openAddToAlbum, close: closeAddToAlbum }] = useDisclosure(false);
  const [modalTagOpen, { open: openTag, close: closeTag }] = useDisclosure(false);
  const [modalSharePhotosOpen, { open: openSharePhotos, close: closeSharePhotos }] = useDisclosure(false);
  const [modalAlbumShareOpen, { open: openAlbumShare, close: closeAlbumShare }] = useDisclosure(false);
  const [modalCoverPickerOpen, { open: openCoverPicker, close: closeCoverPicker }] = useDisclosure(false);
  const [coverPickerAlbumType, setCoverPickerAlbumType] = useState<AlbumCoverType | null>(null);

  // Tag the selection from the keyboard, the way Shotwell's Ctrl+T does. A
  // bare "t" rather than a modifier because browsers reserve Ctrl+T for a new
  // tab and a page cannot take it back -- and because the lightbox already
  // binds bare f/h/p/i/z for the same kind of action. Mantine's useHotkeys
  // ignores INPUT/TEXTAREA/SELECT, so this never fires from the search box.
  useHotkeys([
    [
      "t",
      () => {
        const { selectMode, selectAllMode, selectedItems } = selectionStateRef.current;
        if (!isPublic && (selectAllMode || (selectMode && selectedItems.length > 0))) {
          openTag();
        }
      },
    ],
  ]);

  return {
    addToAlbum: { opened: modalAddToAlbumOpen, open: openAddToAlbum, close: closeAddToAlbum },
    tag: { opened: modalTagOpen, open: openTag, close: closeTag },
    sharePhotos: { opened: modalSharePhotosOpen, open: openSharePhotos, close: closeSharePhotos },
    albumShare: { opened: modalAlbumShareOpen, open: openAlbumShare, close: closeAlbumShare },
    coverPicker: { opened: modalCoverPickerOpen, open: openCoverPicker, close: closeCoverPicker },
    coverPickerAlbumType,
    setCoverPickerAlbumType,
  };
};

export type PhotoListDialogState = ReturnType<typeof usePhotoListDialogs>;
