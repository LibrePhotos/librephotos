import React, { useState, useCallback, useRef } from "react";
import { Lightbox } from "../../../components/lightbox/Lightbox";

/**
 * Custom hook for managing lightbox state with stable navigation support.
 * 
 * This hook solves the problem where images can be hidden/deleted while the lightbox 
 * is open, causing navigation to break when the idx2hash list gets updated to exclude 
 * the currently visible image.
 * 
 * Solution approach:
 * 1. Snapshot the navigation context (idx2hash) when the lightbox first opens
 * 2. Use this snapshot for stable navigation even if the source list changes
 * 3. Handle edge cases where the current image no longer exists in either list
 * 4. Provide fallback navigation to a nearby image when necessary
 * 
 * This ensures users can always navigate between images in the lightbox, even if 
 * some images in the original list become unavailable during the session.
 */
export function useLightbox(onChangedIndex?: (currentIndex?: number) => void) {
  const [lightboxImageId, setLightboxImageId] = useState("");
  const [lightboxShow, setLightboxShow] = useState(false);
  const [scrollLocked, setScrollLocked] = useState(false);
  
  // Snapshot the idx2hash when lightbox opens to maintain stable navigation
  const navigationSnapshot = useRef<Array<{ id: string }>>([]);
  const originalImageId = useRef<string>("");

  const showLightbox = useCallback((imageId: string, isValid: boolean) => {
    setLightboxImageId(imageId);
    setLightboxShow(isValid);
    setScrollLocked(isValid);
    
    // Store the original image ID for fallback purposes
    if (isValid) {
      originalImageId.current = imageId;
    }
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxShow(false);
    setScrollLocked(false);
    // Clear the snapshot when closing
    navigationSnapshot.current = [];
    originalImageId.current = "";
  }, []);

  const renderLightbox = useCallback((idx2hash: Array<{ id: string }>) => {
    if (!lightboxShow) return null;

    // On first render or when lightbox opens, snapshot the navigation context
    if (navigationSnapshot.current.length === 0) {
      navigationSnapshot.current = [...idx2hash];
    }

    // Determine which navigation list to use
    let effectiveIdx2hash = navigationSnapshot.current;
    
    // Check if the current image still exists in the updated list
    const currentImageExistsInUpdated = idx2hash.some(item => item.id === lightboxImageId);
    const currentImageExistsInSnapshot = navigationSnapshot.current.some(item => item.id === lightboxImageId);
    
    // If the current image no longer exists in the snapshot but exists in the updated list,
    // it means we need to handle navigation differently
    if (!currentImageExistsInSnapshot && currentImageExistsInUpdated) {
      // Use the updated list since our snapshot is stale
      effectiveIdx2hash = idx2hash;
      navigationSnapshot.current = [...idx2hash];
    } else if (!currentImageExistsInUpdated && !currentImageExistsInSnapshot) {
      // Image doesn't exist in either list - this shouldn't happen but let's handle it gracefully
      // Try to find a suitable replacement image (nearest by index)
      if (idx2hash.length > 0) {
        const originalIndex = navigationSnapshot.current.findIndex(item => item.id === originalImageId.current);
        const fallbackIndex = Math.min(originalIndex >= 0 ? originalIndex : 0, idx2hash.length - 1);
        const fallbackImageId = idx2hash[fallbackIndex]?.id;
        
        if (fallbackImageId && fallbackImageId !== lightboxImageId) {
          setLightboxImageId(fallbackImageId);
        }
        
        effectiveIdx2hash = idx2hash;
        navigationSnapshot.current = [...idx2hash];
      }
    }
    // If currentImageExistsInSnapshot is true, we keep using the snapshot for stable navigation

    return (
      <Lightbox
        isPublic={false}
        idx2hash={effectiveIdx2hash}
        selectedImage={lightboxImageId}
        onChangedIndex={onChangedIndex || (() => {})}
        onCloseRequest={closeLightbox}
      />
    );
  }, [lightboxShow, lightboxImageId, closeLightbox, onChangedIndex]);

  return {
    showLightbox,
    closeLightbox,
    renderLightbox,
    isLightboxOpen: lightboxShow,
    scrollLocked
  };
} 