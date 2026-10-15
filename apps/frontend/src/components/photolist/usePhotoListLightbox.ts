import type { Photo, PigPhoto } from "@librephotos/api-client";
import { useLocation, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useFetchPhotoDetailsQuery } from "../../api_client/photos/hooks";
import type { LightboxItem } from "../lightbox/lightbox.types";
import type { PigHandle } from "./PhotoListView";
import { photoListScrollRestorationKey } from "./photoSearch";

type Options = Readonly<{
  /** The list has loaded, so a photo the address names can be looked up in it. */
  ready: boolean;
  /** Public and shared views get no photo details, so a photo not in the list cannot be checked. */
  isPublic: boolean;
}>;

/**
 * How the open lightbox shows its photo: stepping through the list, or alone, for an address that
 * names a photo the list does not hold (another page of it, filtered away, or not there at all).
 */
type LightboxView = "list" | "alone";

const isInList = (idx2hash: PigPhoto[], id: string) => idx2hash.some(item => item.id === id && !item.isTemp);

// A photo shown alone, as the grid would have handed it to the lightbox.
const aloneItem = (id: string, details: Photo): LightboxItem => ({
  id,
  image_hash: details.image_hash,
  type: details.video ? "video" : "image",
  date: details.exif_timestamp,
  location: details.search_location ?? undefined,
});

/**
 * The lightbox over a photo list, and keeping the grid scrolled to the photo last viewed. The open
 * photo lives in the address, as `?photo=<id>` (#2231): opening one adds a history entry, so Back
 * closes it; stepping to the next or previous one replaces that entry, so Back does not walk
 * through every photo viewed. A reload or a link reopens the photo once the list has loaded.
 */
export const usePhotoListLightbox = (
  idx2hash: PigPhoto[],
  pigRef: RefObject<PigHandle<PigPhoto> | null>,
  gridRef: RefObject<HTMLDivElement | null>,
  { ready, isPublic }: Options
) => {
  const currentImageIndexRef = useRef(0);
  const navigate = useNavigate();
  const router = useRouter();
  const photo = useSearch({ strict: false, select: search => search.photo });
  // The entry the lightbox pushed names the grid entry it came from; the grid entry has none.
  const pushedFrom = useLocation({ select: location => location.state.lightboxFrom });
  const gridKey = useLocation({ select: photoListScrollRestorationKey });
  const [view, setView] = useState<LightboxView | null>(null);

  // Settled once per opening, from the list as it is then: a photo deleted while it is open, or a
  // stack member picked in the sidebar, is not in the list either, and must not end the stepping.
  useEffect(() => {
    if (photo === undefined) setView(null);
    else if (view === null && ready) setView(isInList(idx2hash, photo) ? "list" : "alone");
  }, [photo, view, ready, idx2hash]);

  // A photo shown alone opens once its details confirm the viewer may see it.
  const alone = view === "alone" && photo !== undefined;
  const details = useFetchPhotoDetailsQuery(photo ?? "", !alone || isPublic);
  const lightboxOpen = photo !== undefined && (view === "list" || (alone && !!details.data));

  const showLightbox = useCallback(
    (imageId: string, isValid: boolean, { replace = false }: { replace?: boolean } = {}) => {
      if (!isValid) return;
      void navigate({
        to: ".",
        search: prev => ({ ...prev, photo: imageId }),
        // A replaced entry (a slideshow started by its own address) has nothing to go back to.
        state: replace ? undefined : { lightboxFrom: gridKey },
        replace,
        resetScroll: false,
      });
    },
    [navigate, gridKey]
  );

  // The one way the lightbox closes, so a later unsaved-changes guard can stop it in one place.
  const closeLightbox = useCallback(() => {
    if (pushedFrom !== undefined) {
      router.history.back();
      return;
    }
    // Opened by a link or a reload: there is no grid entry behind it to go back to.
    void navigate({ to: ".", search: prev => ({ ...prev, photo: undefined }), replace: true, resetScroll: false });
  }, [pushedFrom, router, navigate]);

  // An address naming a photo that cannot be shown leaves the grid as it is.
  const unavailable = alone && (isPublic || details.isError);
  useEffect(() => {
    if (unavailable) closeLightbox();
  }, [unavailable, closeLightbox]);

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

  // The next or previous photo, or a stack member: in place, Back still closes the lightbox.
  const handleLightboxImageChange = useCallback(
    (imageId: string) => {
      void navigate({
        to: ".",
        search: prev => ({ ...prev, photo: imageId }),
        state: true,
        replace: true,
        resetScroll: false,
      });
    },
    [navigate]
  );

  return {
    currentImageIndexRef,
    lightboxOpen,
    lightboxImageId: photo ?? "",
    // Set when the lightbox shows a photo the list does not hold: it steps through just that one.
    lightboxAloneItem: alone && details.data ? aloneItem(photo, details.data) : undefined,
    showLightbox,
    closeLightbox,
    handleLightboxIndexChange,
    handleLightboxImageChange,
  };
};

export type PhotoListLightbox = ReturnType<typeof usePhotoListLightbox>;
