import React from "react";
import { PigPhoto } from "../../api_client/photos/types";
import { Lightbox } from "../lightbox/Lightbox";
import { useSlideshowSelection } from "./useSlideshowSelection";

type Props = {
  items: PigPhoto[];
  onClose: () => void;
};

/**
 * A memory, playing. One year's photos or every year in a row -- the caller
 * decides which by what it passes, and starts a new one over by mounting this
 * afresh (see the `key` on the memories page).
 */
export function MemorySlideshow({ items, onClose }: Props) {
  const { selectedImage, onImageChange } = useSlideshowSelection(items);

  if (selectedImage === null) {
    return null;
  }

  return (
    <Lightbox
      idx2hash={items}
      isPublic={false}
      startSlideshow
      selectedImage={selectedImage}
      onImageChange={onImageChange}
      onCloseRequest={onClose}
      onChangedIndex={() => {}}
    />
  );
}
