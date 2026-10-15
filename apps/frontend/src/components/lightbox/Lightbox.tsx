import { Modal } from "@mantine/core";
import { MotionConfig } from "motion/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useFetchPhotoDetailsQuery } from "../../api_client/photos/hooks";
import { FeatureBoundary, FeatureFallback } from "../common/FeatureBoundary";
import { ContentViewer } from "./ContentViewer";
import { DiscardDraftsModal } from "./DiscardDraftsModal";
import type { LightboxItem, LightBoxProps } from "./lightbox.types";
import { UnsavedDraftsContext } from "./unsavedDrafts";
import { useLightboxDraftsGuard } from "./useUnsavedDraftsGuard";

type ExtendedLightBoxProps = {
  onImageChange?: (imageId: string) => void;
} & LightBoxProps;

/**
 * The id to step to, or null when there is nothing there to show: a grid
 * placeholder for a page that has not loaded yet has a made-up id ("0",
 * "temp-0") and no image hash, so stepping onto it requested /photos/0/.
 */
function navigableId(image: LightboxItem | undefined): string | null {
  if (!image || image.isTemp || !image.image_hash) return null;
  return typeof image.id === "string" && image.id.length ? image.id : null;
}

// Custom hook to track previous value
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

/**
 * A render error inside the viewer (video player, carousel, gestures, caption
 * editor) shows a small dialog with Retry instead of replacing the page behind
 * it. Closing the lightbox unmounts the boundary, so the next open starts clean.
 *
 * With `prefers-reduced-motion`, motion leaves out the zoom as one photo gives way
 * to the next and only cross-fades: a slideshow (#1457) would zoom every few seconds.
 */
export function Lightbox(props: ExtendedLightBoxProps) {
  const { onCloseRequest } = props;
  return (
    <MotionConfig reducedMotion="user">
      <FeatureBoundary
        name="lightbox"
        fallback={({ reset }) => (
          <Modal opened onClose={onCloseRequest} centered>
            <FeatureFallback reset={reset} />
          </Modal>
        )}
      >
        <LightboxViewer {...props} />
      </FeatureBoundary>
    </MotionConfig>
  );
}

function LightboxViewer(props: ExtendedLightBoxProps) {
  const {
    idx2hash,
    isPublic,
    publicAlbumSlug,
    onCloseRequest,
    selectedImage,
    onChangedIndex,
    onImageChange,
    startSlideshow,
  } = props;
  const [lightboxImageId, setLightboxImageId] = useState(selectedImage);
  // Every way off this photo (the arrows and their keys, a swipe, a stack or similar photo, close,
  // Back) asks first while an editor holds an unsaved edit (#2284).
  const { drafts, guard, dialog } = useLightboxDraftsGuard();
  // Track previous idx2hash to detect when current image is deleted
  const previousIdx2hash = usePrevious(idx2hash);

  // Stable navigation snapshot - only used when current image is deleted
  const stableNavigationSnapshot = useRef<LightboxItem[]>([]);
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
  // Skip this query on public pages since we don't have authenticated access to photo details
  const currentImageHash = getImageHashForId(lightboxImageId) || lightboxImageId;
  const { data: photoDetails } = useFetchPhotoDetailsQuery(currentImageHash, isPublic);

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

  const movePrev = useCallback(() => {
    const { idx2hash: effectiveIdx2hash } = getEffectiveNavigation();
    const currentIndex = effectiveIdx2hash.findIndex(image => image.id === lightboxImageId);
    const prevIndex = (currentIndex + effectiveIdx2hash.length - 1) % effectiveIdx2hash.length;
    const newImage = effectiveIdx2hash[prevIndex];
    if (!newImage) return;
    const newImageId = newImage.id;

    setLightboxImageId(newImageId);
    onImageChange?.(newImageId);
  }, [lightboxImageId, getEffectiveNavigation, onImageChange]);

  const moveNext = useCallback(() => {
    const { idx2hash: effectiveIdx2hash } = getEffectiveNavigation();
    const currentIndex = effectiveIdx2hash.findIndex(image => image.id === lightboxImageId);
    const nextIndex = (currentIndex + effectiveIdx2hash.length + 1) % effectiveIdx2hash.length;
    const newImage = effectiveIdx2hash[nextIndex];
    if (!newImage) return;
    const newImageId = newImage.id;

    setLightboxImageId(newImageId);
    onImageChange?.(newImageId);
  }, [lightboxImageId, getEffectiveNavigation, onImageChange]);

  const getPreviousId = () => {
    const { idx2hash: effectiveIdx2hash } = getEffectiveNavigation();
    const currentIndex = effectiveIdx2hash.findIndex(image => image.id === lightboxImageId);

    if (currentIndex <= 0 || !effectiveIdx2hash || !effectiveIdx2hash.length) return null;

    const prevIndex = (currentIndex - 1 + effectiveIdx2hash.length) % effectiveIdx2hash.length;
    return navigableId(effectiveIdx2hash[prevIndex]);
  };

  const getNextId = () => {
    const { idx2hash: effectiveIdx2hash } = getEffectiveNavigation();
    const currentIndex = effectiveIdx2hash.findIndex(image => image.id === lightboxImageId);

    if (currentIndex >= effectiveIdx2hash.length - 1 || !effectiveIdx2hash || !effectiveIdx2hash.length) return null;

    const nextIndex = (currentIndex + 1) % effectiveIdx2hash.length;
    return navigableId(effectiveIdx2hash[nextIndex]);
  };

  const getMediaType = () => {
    if (photoDetails === undefined || photoDetails === null) {
      // A public or shared page never fetches details, but the grid item still
      // knows it is a video. A motion photo stays a still there: its clip is
      // served only to the owner and for photos marked public.
      if (!isPublic) return "photo";
      const item = getEffectiveNavigation().idx2hash.find(photo => photo.id === lightboxImageId);
      return item?.type === "video" ? "video" : "photo";
    }

    if (photoDetails.video) {
      return "video";
    }

    if (photoDetails.embedded_media && photoDetails.embedded_media.length > 0) {
      return "embedded";
    }

    return "photo";
  };

  const mediaType = getMediaType();

  const onMovePrevRequest = useCallback(() => guard(movePrev), [guard, movePrev]);
  const onMoveNextRequest = useCallback(() => guard(moveNext), [guard, moveNext]);

  const handleCloseRequest = useCallback(
    () =>
      guard(() => {
        // Clear the snapshot when closing
        stableNavigationSnapshot.current = [];
        onCloseRequest();
      }),
    [guard, onCloseRequest]
  );

  // Handle photo selection from stack thumbnails in the sidebar
  const handlePhotoSelect = useCallback(
    (photoId: string) =>
      guard(() => {
        setLightboxImageId(photoId);
        onImageChange?.(photoId);
      }),
    [guard, onImageChange]
  );

  // A viewer who is not the owner gets no photo details, only what the grid knows.
  const gridItem = isPublic ? getEffectiveNavigation().idx2hash.find(photo => photo.id === lightboxImageId) : undefined;

  return (
    <UnsavedDraftsContext.Provider value={drafts}>
      <ContentViewer
        mainSrc={lightboxImageId}
        mainSrcHash={currentImageHash}
        nextSrc={getNextId()}
        nextSrcHash={getImageHashForId(getNextId())}
        prevSrc={getPreviousId()}
        prevSrcHash={getImageHashForId(getPreviousId())}
        isPublic={isPublic}
        publicAlbumSlug={publicAlbumSlug}
        type={mediaType}
        enableZoom={mediaType === "photo"}
        onCloseRequest={handleCloseRequest}
        onMovePrevRequest={onMovePrevRequest}
        onMoveNextRequest={onMoveNextRequest}
        onPhotoSelect={handlePhotoSelect}
        startSlideshow={startSlideshow}
        gridItem={gridItem}
      />
      <DiscardDraftsModal
        opened={dialog.opened}
        onClose={dialog.onKeepEditing}
        onDiscard={dialog.onDiscard}
        fields={dialog.fields}
      />
    </UnsavedDraftsContext.Provider>
  );
}
