import React, { useState, useCallback } from "react";
import { Lightbox } from "../components/lightbox/Lightbox";

export function useLightbox() {
  const [lightboxImageId, setLightboxImageId] = useState("");
  const [lightboxShow, setLightboxShow] = useState(false);
  const [scrollLocked, setScrollLocked] = useState(false);

  const showLightbox = useCallback((imageId: string, isValid: boolean) => {
    setLightboxImageId(imageId);
    setLightboxShow(isValid);
    setScrollLocked(isValid);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxShow(false);
    setScrollLocked(false);
  }, []);

  const renderLightbox = useCallback((idx2hash: Array<{ id: string }>) => 
    lightboxShow && (
      <Lightbox
        isPublic={false}
        idx2hash={idx2hash}
        selectedImage={lightboxImageId}
        onChangedIndex={() => {}}
        onCloseRequest={closeLightbox}
      />
    ), [lightboxShow, lightboxImageId, closeLightbox]);

  return {
    showLightbox,
    closeLightbox,
    renderLightbox,
    isLightboxOpen: lightboxShow,
    scrollLocked
  };
} 