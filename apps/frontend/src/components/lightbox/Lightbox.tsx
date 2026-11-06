import { Modal } from "@mantine/core";
import { MotionConfig } from "motion/react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetchPhotoDetailsQuery } from "../../api_client/photos/hooks";
import { useAuth } from "../../hooks/useAuth";
import { FeatureBoundary, FeatureFallback } from "../common/FeatureBoundary";
import { ContentViewer } from "./ContentViewer";
import { DiscardDraftsModal } from "./DiscardDraftsModal";
import type { LightboxItem, LightBoxProps } from "./lightbox.types";
import { adoptsLive, indexOfId, neighbour } from "./lightboxNavigation";
import { LightboxTitle } from "./LightboxTitle";
import { UnsavedDraftsContext } from "./unsavedDrafts";
import { useLightboxDraftsGuard } from "./useUnsavedDraftsGuard";
import { VideoStartContext, videoStartFor } from "./videoStart";

type ExtendedLightBoxProps = {
  onImageChange?: (imageId: string) => void;
} & LightBoxProps;

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

/** Whether a photo whose owner is known belongs to someone other than the viewer. */
function isSomeoneElses(ownerId: number | undefined, userId: number | null): boolean {
  return ownerId !== undefined && userId !== null && ownerId !== userId;
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
  // The address names another photo (Back, a link, the grid): show that one. Compared while
  // rendering, as an effect would first render the old photo against the new address.
  const [addressedImage, setAddressedImage] = useState(selectedImage);
  if (selectedImage !== addressedImage) {
    setAddressedImage(selectedImage);
    setLightboxImageId(selectedImage);
  }
  // Every way off this photo (the arrows and their keys, a swipe, a stack or similar photo, close,
  // Back) asks first while an editor holds an unsaved edit (#2284).
  const { drafts, guard, dialog } = useLightboxDraftsGuard();
  const { items, index, liveIndex, removed, markRemoved } = useLightboxList(idx2hash, lightboxImageId);
  const currentItem = index === -1 ? undefined : items[index];
  const prevItem = neighbour(items, index, -1, removed);
  const nextItem = neighbour(items, index, 1, removed);
  const prevId = prevItem?.id ?? null;
  const nextId = nextItem?.id ?? null;

  // Fetch photo details using image_hash (backend still uses image_hash for lookup)
  // Skip this query on public pages since we don't have authenticated access to photo details
  const currentImageHash = currentItem?.image_hash || lightboxImageId;
  const { data: photoDetails } = useFetchPhotoDetailsQuery(currentImageHash, isPublic);
  // Someone else's photo is read only: one a member added to your album (#464), one from a library
  // shared with you (#2731).
  const { userId } = useAuth();
  const readOnly = isPublic || Boolean(photoDetails?.shared_library) || isSomeoneElses(photoDetails?.owner?.id, userId);

  // The grid follows the photo shown, so it is there when the lightbox closes. Only when the
  // photo's place changes: not again for every day page the grid loads meanwhile.
  useEffect(() => {
    if (liveIndex !== -1) onChangedIndex(liveIndex);
  }, [liveIndex, onChangedIndex]);

  const goTo = useCallback(
    (id: string) => {
      setLightboxImageId(id);
      onImageChange?.(id);
    },
    [onImageChange]
  );
  const onMovePrevRequest = useCallback(
    () =>
      guard(() => {
        if (prevId !== null) goTo(prevId);
      }),
    [guard, goTo, prevId]
  );
  const onMoveNextRequest = useCallback(
    () =>
      guard(() => {
        if (nextId !== null) goTo(nextId);
      }),
    [guard, goTo, nextId]
  );

  // A trashed (or, in the trash, restored) photo leaves the list it was opened from: step to the
  // photo after it, or before it at the end, in the list as the lightbox knows it (the grid's own
  // list may still be refilling). False when there is nothing left to show.
  const shown = useRef({ id: lightboxImageId, items, index });
  useEffect(() => {
    shown.current = { id: lightboxImageId, items, index };
  });
  const handleTrashToggled = useCallback(
    (id: string) => {
      const nowRemoved = markRemoved(id);
      const { id: shownId, items: shownItems, index: shownIndex } = shown.current;
      // The user moved on while the request ran: stay where they are.
      if (shownId !== id) return true;
      const target =
        neighbour(shownItems, shownIndex, 1, nowRemoved) ?? neighbour(shownItems, shownIndex, -1, nowRemoved);
      if (target === null) return false;
      guard(() => goTo(target.id));
      return true;
    },
    [markRemoved, guard, goTo]
  );

  const getMediaType = () => {
    if (photoDetails === undefined || photoDetails === null) {
      // A public or shared page never fetches details, but the grid item still
      // knows it is a video. A motion photo stays a still there: its clip is
      // served only to the owner and for photos marked public.
      if (!isPublic) return "photo";
      return currentItem?.type === "video" ? "video" : "photo";
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

  const handleCloseRequest = useCallback(() => guard(onCloseRequest), [guard, onCloseRequest]);

  // Handle photo selection from stack thumbnails in the sidebar
  const handlePhotoSelect = useCallback((photoId: string) => guard(() => goTo(photoId)), [guard, goTo]);

  const position = useListPosition(items, index, removed);

  // A viewer who is not the owner gets no photo details, only what the grid knows.
  const gridItem = readOnly ? currentItem : undefined;

  return (
    <UnsavedDraftsContext.Provider value={drafts}>
      <VideoStartContext.Provider value={videoStartFor(items, lightboxImageId)}>
        <ContentViewer
          mainSrc={lightboxImageId}
          mainSrcHash={currentImageHash}
          nextSrc={nextId}
          nextSrcHash={nextItem?.image_hash ?? null}
          prevSrc={prevId}
          prevSrcHash={prevItem?.image_hash ?? null}
          isPublic={readOnly}
          publicAlbumSlug={publicAlbumSlug}
          type={mediaType}
          enableZoom={mediaType === "photo"}
          onCloseRequest={handleCloseRequest}
          onMovePrevRequest={onMovePrevRequest}
          onMoveNextRequest={onMoveNextRequest}
          onPhotoSelect={handlePhotoSelect}
          onTrashToggled={handleTrashToggled}
          startSlideshow={startSlideshow}
          gridItem={gridItem}
          toolbarTitle={
            <LightboxTitle
              // A viewer who is not the owner has no details: the grid's date and place
              timestamp={photoDetails?.exif_timestamp ?? currentItem?.date}
              place={photoDetails?.search_location ?? currentItem?.location}
              position={position}
            />
          }
        />
      </VideoStartContext.Provider>
      <DiscardDraftsModal
        opened={dialog.opened}
        onClose={dialog.onKeepEditing}
        onDiscard={dialog.onDiscard}
        fields={dialog.fields}
      />
    </UnsavedDraftsContext.Provider>
  );
}

/**
 * The list the lightbox steps through and where the shown photo sits in it. That is the grid's
 * list (`idx2hash`) once it holds the photo without having lost a neighbour; while the grid
 * refills after a photo action, the last list that did (see adoptsLive). `removed` are the photos
 * trashed here, which every step passes over, as the list kept meanwhile still has them.
 * `liveIndex` is the photo's place in the grid's list, -1 while it is not there.
 *
 * Only references are kept: a 200k-photo timeline is never copied.
 */
function useLightboxList(idx2hash: LightboxItem[], shownId: string) {
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [known, setKnown] = useState<LightboxItem[] | null>(null);
  const liveIndex = useMemo(() => indexOfId(idx2hash, shownId), [idx2hash, shownId]);
  const knownIndex = useMemo(
    () => (known === null || known === idx2hash ? liveIndex : indexOfId(known, shownId)),
    [known, idx2hash, shownId, liveIndex]
  );
  const live = { items: idx2hash, index: liveIndex };
  const kept = known === null ? null : { items: known, index: knownIndex };
  const takesLive = adoptsLive(live, kept, removed);
  // State derived from props, adjusted while rendering as React documents it: a list is only ever
  // replaced by a newer one, so this settles in one extra render.
  if (takesLive && known !== idx2hash) setKnown(idx2hash);
  const current = takesLive || kept === null ? live : kept;

  const removedRef = useRef(removed);
  const markRemoved = useCallback((id: string) => {
    const next = new Set(removedRef.current).add(id);
    removedRef.current = next;
    setRemoved(next);
    return next;
  }, []);

  return { items: current.items, index: current.index, liveIndex, removed, markRemoved };
}

/**
 * Where the shown photo is in the list, counted from 1, as the toolbar's title says it ("12 of
 * 198"): the photos trashed here are no longer counted. A grid placeholder for a page that has not
 * loaded yet still counts, as the photo it stands for is there.
 */
function useListPosition(items: LightboxItem[], index: number, removed: ReadonlySet<string>) {
  return useMemo(() => {
    if (index === -1) return undefined;
    let removedBefore = 0;
    let removedListed = 0;
    for (const id of removed) {
      const at = indexOfId(items, id);
      if (at === -1) continue;
      removedListed += 1;
      if (at < index) removedBefore += 1;
    }
    return { current: index + 1 - removedBefore, total: items.length - removedListed };
  }, [items, index, removed]);
}
