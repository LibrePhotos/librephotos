/**
 * Stack Lightbox - A lightbox wrapper for viewing photos in a stack
 * Uses the standard ContentViewer navigation
 */
import { useHotkeys } from "@mantine/hooks";
import React, { useCallback, useEffect, useState } from "react";
import { ContentViewer } from "../lightbox/ContentViewer";

type StackPhoto = {
  id: string;
  image_hash: string;
  thumbnail_url: string | null;
  is_primary: boolean;
  file_type?: string | null;
};

type StackLightboxProps = {
  photos: StackPhoto[];
  initialPhotoHash: string;
  onClose: () => void;
  isPublic?: boolean;
};

export function StackLightbox({ photos, initialPhotoHash, onClose, isPublic = false }: StackLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(() => {
    const idx = photos.findIndex(p => p.image_hash === initialPhotoHash);
    return idx >= 0 ? idx : 0;
  });

  const currentPhoto = photos[currentIndex];
  const prevPhoto = currentIndex > 0 ? photos[currentIndex - 1] : null;
  const nextPhoto = currentIndex < photos.length - 1 ? photos[currentIndex + 1] : null;

  // Update current index when initial photo changes
  useEffect(() => {
    const idx = photos.findIndex(p => p.image_hash === initialPhotoHash);
    if (idx >= 0) {
      setCurrentIndex(idx);
    }
  }, [initialPhotoHash, photos]);

  const goToPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  }, [currentIndex]);

  const goToNext = useCallback(() => {
    if (currentIndex < photos.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  }, [currentIndex, photos.length]);

  const goToIndex = useCallback(
    (index: number) => {
      if (index >= 0 && index < photos.length) {
        setCurrentIndex(index);
      }
    },
    [photos.length]
  );

  // Keyboard shortcuts to jump directly to photo by number
  useHotkeys([
    ["1", () => goToIndex(0)],
    ["2", () => photos.length >= 2 && goToIndex(1)],
    ["3", () => photos.length >= 3 && goToIndex(2)],
    ["4", () => photos.length >= 4 && goToIndex(3)],
    ["5", () => photos.length >= 5 && goToIndex(4)],
    ["6", () => photos.length >= 6 && goToIndex(5)],
    ["7", () => photos.length >= 7 && goToIndex(6)],
    ["8", () => photos.length >= 8 && goToIndex(7)],
    ["9", () => photos.length >= 9 && goToIndex(8)],
  ]);

  const getMediaType = () => {
    const fileType = currentPhoto?.file_type?.toLowerCase();
    if (fileType?.includes("video")) return "video";
    return "photo";
  };

  return (
    <ContentViewer
      mainSrc={currentPhoto.id}
      mainSrcHash={currentPhoto.image_hash}
      prevSrc={prevPhoto?.id ?? null}
      prevSrcHash={prevPhoto?.image_hash ?? null}
      nextSrc={nextPhoto?.id ?? null}
      nextSrcHash={nextPhoto?.image_hash ?? null}
      isPublic={isPublic}
      type={getMediaType()}
      enableZoom
      onCloseRequest={onClose}
      onMovePrevRequest={goToPrev}
      onMoveNextRequest={goToNext}
      onImageLoad={() => {}}
    />
  );
}
