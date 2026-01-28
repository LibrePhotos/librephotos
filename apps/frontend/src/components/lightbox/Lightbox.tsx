import React, { useCallback, useEffect, useRef, useState } from "react";
import { useFetchPhotoDetailsQuery } from "../../api_client/photos/hooks";
import { ContentViewer } from "./ContentViewer";
import type { LightBoxProps } from "./lightbox.types";

interface ExtendedLightBoxProps extends LightBoxProps {
  onImageChange?: (imageId: string) => void;
}

// Custom hook to track previous value
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

export function Lightbox(props: ExtendedLightBoxProps) {
  const { idx2hash, isPublic, onCloseRequest, selectedImage, onChangedIndex, onImageChange } = props;
  const [lightboxImageId, setLightboxImageId] = useState(selectedImage);
  // Track previous idx2hash to detect when current image is deleted
  const previousIdx2hash = usePrevious(idx2hash);

  // Stable navigation snapshot - only used when current image is deleted
  const stableNavigationSnapshot = useRef<Array<{ id: string; image_hash: string }>>([]);
  const usingStableNavigation = useRef<boolean>(false);

  // Get the effective navigation list
  const getEffectiveNavigation = useCallback(() => {
    // Use stable navigation if current image was deleted, otherwise use live list
    const effectiveIdx2hash = usingStableNavigation.current ? stableNavigationSnapshot.current : idx2hash;
    return { idx2hash: effectiveIdx2hash };
  }, [idx2hash]);

  // Get image_hash for an ID (for media URLs)
  const getImageHashForId = useCallback(
    (id: string | null): string | null => {
      if (!id) return null;
      const { idx2hash: effectiveIdx2hash } = getEffectiveNavigation();
      const foundItem = effectiveIdx2hash.find(photo => photo.id === id);
      return foundItem?.image_hash || id;
    },
    [getEffectiveNavigation]
  );

  // Fetch photo details using image_hash (backend still uses image_hash for lookup)
  const currentImageHash = getImageHashForId(lightboxImageId) || lightboxImageId;
  const { data: photoDetails } = useFetchPhotoDetailsQuery(currentImageHash);

  // Initialize and handle navigation context
  useEffect(() => {
    if (selectedImage !== lightboxImageId) {
      setLightboxImageId(selectedImage);
      // Reset to normal navigation when a new image is selected
      usingStableNavigation.current = false;
      stableNavigationSnapshot.current = [];
    }
  }, [selectedImage, idx2hash, lightboxImageId]);

  // Detect if current image was deleted and switch to stable navigation
  useEffect(() => {
    if (!previousIdx2hash) return;

    const currentImageExistsInNew = idx2hash.some(item => item.id === lightboxImageId);
    const currentImageExistsInPrevious = previousIdx2hash.some(item => item.id === lightboxImageId);

    // If image existed before but doesn't exist now, it was deleted
    if (currentImageExistsInPrevious && !currentImageExistsInNew && !usingStableNavigation.current) {
      // Switch to stable navigation using the previous list
      stableNavigationSnapshot.current = [...previousIdx2hash];
      usingStableNavigation.current = true;
    }

    // If we're using stable navigation but the image reappears, switch back to live navigation
    if (usingStableNavigation.current && currentImageExistsInNew) {
      usingStableNavigation.current = false;
      stableNavigationSnapshot.current = [];
    }
  }, [idx2hash, lightboxImageId, previousIdx2hash]);

  // Update index only when image exists in current idx2hash
  useEffect(() => {
    const currentIndex = idx2hash.findIndex(image => image.id === lightboxImageId);
    if (currentIndex !== -1) {
      onChangedIndex(currentIndex);
    }
    // If image doesn't exist in current idx2hash, don't update the index
  }, [lightboxImageId, idx2hash, onChangedIndex]);

  const onMovePrevRequest = useCallback(() => {
    const { idx2hash: effectiveIdx2hash } = getEffectiveNavigation();
    const currentIndex = effectiveIdx2hash.findIndex(image => image.id === lightboxImageId);
    const prevIndex = (currentIndex + effectiveIdx2hash.length - 1) % effectiveIdx2hash.length;
    const newImageId = effectiveIdx2hash[prevIndex].id;

    setLightboxImageId(newImageId);
    onImageChange?.(newImageId);
  }, [lightboxImageId, getEffectiveNavigation, onImageChange]);

  const onMoveNextRequest = useCallback(() => {
    const { idx2hash: effectiveIdx2hash } = getEffectiveNavigation();
    const currentIndex = effectiveIdx2hash.findIndex(image => image.id === lightboxImageId);
    const nextIndex = (currentIndex + effectiveIdx2hash.length + 1) % effectiveIdx2hash.length;
    const newImageId = effectiveIdx2hash[nextIndex].id;

    setLightboxImageId(newImageId);
    onImageChange?.(newImageId);
  }, [lightboxImageId, getEffectiveNavigation, onImageChange]);

  const getPreviousId = () => {
    const { idx2hash: effectiveIdx2hash } = getEffectiveNavigation();
    const currentIndex = effectiveIdx2hash.findIndex(image => image.id === lightboxImageId);

    if (currentIndex <= 0 || !effectiveIdx2hash || !effectiveIdx2hash.length) return null;

    const prevIndex = (currentIndex - 1 + effectiveIdx2hash.length) % effectiveIdx2hash.length;
    const image = effectiveIdx2hash[prevIndex];

    // Check if image and image.id exist and image.id is a valid string (not just a numeric index)
    if (!image || !image.id || typeof image.id !== "string" || !image.id.length) return null;

    // Additional validation to ensure it's a hash (should contain alphanumeric characters)
    return /^[a-zA-Z0-9-]+$/.test(image.id) ? image.id : null;
  };

  const getNextId = () => {
    const { idx2hash: effectiveIdx2hash } = getEffectiveNavigation();
    const currentIndex = effectiveIdx2hash.findIndex(image => image.id === lightboxImageId);

    if (currentIndex >= effectiveIdx2hash.length - 1 || !effectiveIdx2hash || !effectiveIdx2hash.length) return null;

    const nextIndex = (currentIndex + 1) % effectiveIdx2hash.length;
    const image = effectiveIdx2hash[nextIndex];

    // Check if image and image.id exist and image.id is a valid string (not just a numeric index)
    if (!image || !image.id || typeof image.id !== "string" || !image.id.length) return null;

    // Additional validation to ensure it's a hash (should contain alphanumeric characters)
    return /^[a-zA-Z0-9-]+$/.test(image.id) ? image.id : null;
  };

  const getMediaType = () => {
    if (photoDetails === undefined || photoDetails === null) {
      return "photo";
    }

    if (photoDetails.video) {
      return "video";
    }

    if (photoDetails.embedded_media && photoDetails.embedded_media.length > 0) {
      return "embedded";
    }

    return "photo";
  };

  const handleCloseRequest = useCallback(() => {
    // Clear the snapshot when closing
    stableNavigationSnapshot.current = [];
    onCloseRequest();
  }, [onCloseRequest]);

  // Handle photo selection from stack thumbnails in the sidebar
  const handlePhotoSelect = useCallback(
    (photoId: string) => {
      setLightboxImageId(photoId);
      onImageChange?.(photoId);
    },
    [onImageChange]
  );

  return (
    <div>
      <ContentViewer
        mainSrc={lightboxImageId}
        mainSrcHash={currentImageHash}
        nextSrc={getNextId()}
        nextSrcHash={getImageHashForId(getNextId())}
        prevSrc={getPreviousId()}
        prevSrcHash={getImageHashForId(getPreviousId())}
        isPublic={isPublic}
        type={getMediaType()}
        enableZoom={getMediaType() === "photo"}
        onCloseRequest={handleCloseRequest}
        onMovePrevRequest={onMovePrevRequest}
        onMoveNextRequest={onMoveNextRequest}
        onImageLoad={() => {}}
        onPhotoSelect={handlePhotoSelect}
      />
    </div>
  );
}
