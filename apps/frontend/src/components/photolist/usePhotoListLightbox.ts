import type { PigPhoto } from "@librephotos/api-client";
import { useDisclosure } from "@mantine/hooks";
import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import type { PigHandle } from "./PhotoListView";

// The lightbox over a photo list: which photo it shows, and keeping the grid
// scrolled to the photo last viewed.
export const usePhotoListLightbox = (
  idx2hash: PigPhoto[],
  pigRef: RefObject<PigHandle<PigPhoto> | null>,
  gridRef: RefObject<HTMLDivElement | null>
) => {
  const currentImageIndexRef = useRef(0);

  // Simple lightbox state management
  const [lightboxOpen, { open: openLightbox, close: hideLightbox }] = useDisclosure(false);
  const [lightboxImageId, setLightboxImageId] = useState("");

  const showLightbox = useCallback(
    (imageId: string, isValid: boolean) => {
      if (isValid) {
        setLightboxImageId(imageId);
        openLightbox();
      }
    },
    [openLightbox]
  );

  const closeLightbox = useCallback(() => {
    hideLightbox();
    setLightboxImageId("");
  }, [hideLightbox]);

  const handleLightboxIndexChange = useCallback(
    (currentIndex?: number) => {
      // Update the current image index if provided from lightbox
      if (currentIndex !== undefined) {
        currentImageIndexRef.current = currentIndex;
      }

      // Scroll to the current image's position
      if (pigRef.current && idx2hash[currentImageIndexRef.current]) {
        // Use setTimeout to ensure DOM is updated after lightbox is closed
        setTimeout(() => {
          // Read the tile's position from Pig's layout rather than the DOM: the
          // grid is virtualised, so the tile may not be rendered, and video
          // tiles have no <img> to match on (the old index fallback then
          // pointed at an unrelated tile).
          const currentId = idx2hash[currentImageIndexRef.current]?.id;
          const layout = pigRef.current?.imageData ?? [];
          const tile = layout
            .flatMap(entry => ("items" in entry ? entry.items : [entry]))
            .find(entry => entry.id === currentId);
          const { translateY, height: tileHeight } = tile?.style ?? {};
          const grid = gridRef.current;
          if (translateY === undefined || tileHeight === undefined || !grid) return;
          // Pig is the grid wrapper's only child, inside its padding.
          const pig = grid.firstElementChild ?? grid;
          const tileTop = pig.getBoundingClientRect().top + window.scrollY + translateY;
          // Centre the tile, so it is not left under the sticky header.
          window.scrollTo({
            top: Math.max(0, tileTop - (window.innerHeight - tileHeight) / 2),
            behavior: "smooth",
          });
        }, 100);
      }
    },
    [idx2hash, pigRef, gridRef]
  );

  const handleLightboxImageChange = useCallback((imageId: string) => {
    setLightboxImageId(imageId);
  }, []);

  return {
    currentImageIndexRef,
    lightboxOpen,
    lightboxImageId,
    showLightbox,
    closeLightbox,
    handleLightboxIndexChange,
    handleLightboxImageChange,
  };
};

export type PhotoListLightbox = ReturnType<typeof usePhotoListLightbox>;
