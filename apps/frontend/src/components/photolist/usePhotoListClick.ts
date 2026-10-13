import type { PigPhoto } from "@librephotos/api-client";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import type React from "react";
import type { RefObject } from "react";
import type { SelectionState } from "../../api_client/photos/types";

type Props = {
  idx2hashRef: RefObject<PigPhoto[]>;
  selectable: boolean;
  selectionStateRef: RefObject<SelectionState>;
  handleSelection: (item: PigPhoto) => void;
  handleSelections: (items: PigPhoto[]) => void;
  currentImageIndexRef: RefObject<number>;
  showLightbox: (imageId: string, isValid: boolean) => void;
};

// What a click on a photo tile does: select it (in select mode, or a range with
// shift), open the single photo page (Ctrl/Cmd), or open the lightbox.
export const usePhotoListClick = ({
  idx2hashRef,
  selectable,
  selectionStateRef,
  handleSelection,
  handleSelections,
  currentImageIndexRef,
  showLightbox,
}: Props) => {
  const navigate = useNavigate();

  return useCallback(
    (event: React.MouseEvent<Element, MouseEvent>, item: PigPhoto) => {
      // if an image is selectable, then handle shift click
      if (selectable && event.shiftKey) {
        const lastSelectedElement = selectionStateRef.current.selectedItems.at(-1);
        if (lastSelectedElement === undefined) {
          handleSelection(item);
          return;
        }
        const indexOfCurrentlySelectedItem = idx2hashRef.current.findIndex(image => image.id === item.id);
        const indexOfLastSelectedItem = idx2hashRef.current.findIndex(image => image.id === lastSelectedElement.id);

        if (indexOfCurrentlySelectedItem > indexOfLastSelectedItem) {
          handleSelections(idx2hashRef.current.slice(indexOfLastSelectedItem + 1, indexOfCurrentlySelectedItem + 1));
          return;
        }
        handleSelections(idx2hashRef.current.slice(indexOfCurrentlySelectedItem, indexOfLastSelectedItem));
        return;
      }
      if (selectionStateRef.current.selectMode) {
        handleSelection(item);
        return;
      }

      // Store image index for later scrolling
      const currentIndex = idx2hashRef.current.findIndex(image => image.id === item.id);
      currentImageIndexRef.current = currentIndex;

      // If Ctrl/Cmd key is pressed, navigate to single photo view
      if (("ctrlKey" in event && event.ctrlKey) || ("metaKey" in event && event.metaKey)) {
        // TanStack Router takes options, not a path: a bare string navigated nowhere.
        void navigate({ to: "/photo/$id", params: { id: item.id } });
        return;
      }

      // Otherwise, open in lightbox
      showLightbox(item.id, currentIndex >= 0);
    },
    [
      selectable,
      handleSelection,
      handleSelections,
      navigate,
      showLightbox,
      currentImageIndexRef,
      selectionStateRef,
      idx2hashRef,
    ]
  );
};
