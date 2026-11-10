import { useHotkeys } from "@mantine/hooks";
import { useMemo, useState } from "react";
import { hasSelection, selectedOf } from "./photoListSelection";
import type { ListSelection } from "./photoListSelection";

/** The modals a photo list opens; at most one at a time. */
type PhotoListDialog = "addToAlbum" | "tag" | "sharePhotos" | "albumShare";

type Options = Readonly<{
  isPublic: boolean;
  readSelection: () => ListSelection;
  /** Something else holds the keyboard (the lightbox): the hotkey leaves it alone. */
  hotkeyEnabled: boolean;
}>;

// The modals a photo list opens from its toolbar, its selection bar and the keyboard. One value
// says which is open, so an opener (the "t" hotkey) cannot stack a second one over the first.
export const usePhotoListDialogs = ({ isPublic, readSelection, hotkeyEnabled }: Options) => {
  const [shown, setShown] = useState<PhotoListDialog | null>(null);

  // Tag the selection from the keyboard, the way Shotwell's Ctrl+T does. A
  // bare "t" rather than a modifier because browsers reserve Ctrl+T for a new
  // tab and a page cannot take it back -- and because the lightbox already
  // binds bare f/h/p/i/z for the same kind of action. Mantine's useHotkeys
  // ignores INPUT/TEXTAREA/SELECT, so this never fires from the search box.
  useHotkeys([
    [
      "t",
      () => {
        if (isPublic || !hotkeyEnabled || shown !== null) return;
        if (hasSelection(selectedOf(readSelection(), 0))) setShown("tag");
      },
    ],
  ]);

  return useMemo(() => {
    const disclosure = (dialog: PhotoListDialog) => ({
      opened: shown === dialog,
      open: () => setShown(dialog),
      // Only its own: a late close of one modal does not shut the one that replaced it
      close: () => setShown(current => (current === dialog ? null : current)),
    });
    return {
      addToAlbum: disclosure("addToAlbum"),
      tag: disclosure("tag"),
      sharePhotos: disclosure("sharePhotos"),
      albumShare: disclosure("albumShare"),
    };
  }, [shown]);
};

export type PhotoListDialogState = ReturnType<typeof usePhotoListDialogs>;
