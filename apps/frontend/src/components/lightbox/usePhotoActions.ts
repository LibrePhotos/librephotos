import type { Photo } from "@librephotos/api-client";
import { useCallback, useState } from "react";
import {
  useFetchPhotoSharesQuery,
  useMarkPhotosDeletedMutation,
  useSetFavoritePhotosMutation,
  useSetPhotosHiddenMutation,
} from "../../api_client/photos/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";

type Options = {
  /** null or undefined while the details load, or when there are none to load. */
  photoDetail: Photo | null | undefined;
  /** A viewer who is not the owner: every action is a no-op, and nothing owner-only is fetched. */
  isPublic: boolean;
  /** Called once the photo was moved to (or restored from) the trash. */
  onAfterTrashToggle?: () => void;
};

/**
 * The owner's actions on one photo, shared by the lightbox toolbar and the
 * photo page: favourite, hide, share link and trash, with their state. Each
 * action does nothing without details or for a viewer who is not the owner,
 * so a keyboard shortcut can call it blindly. The labels are each surface's
 * own: the lightbox names its shortcut keys, the page has none.
 */
export function usePhotoActions({ photoDetail, isPublic, onAfterTrashToggle }: Options) {
  const { data: userDetails } = useCurrentUserSelfDetailsQuery();
  const favoriteMinRating = userDetails?.favorite_min_rating ?? 0;
  const { mutate: setFavorite } = useSetFavoritePhotosMutation();
  const { mutate: setHidden } = useSetPhotosHiddenMutation();
  const { mutate: markDeleted } = useMarkPhotosDeletedMutation();
  // Whether this photo has a live share link, for the share button's colour.
  const { data: photoShares } = useFetchPhotoSharesQuery(!isPublic);
  // The share link dialog is open while this holds the photo's id.
  const [sharingPhotoId, setSharingPhotoId] = useState<string | null>(null);

  const photo = isPublic ? null : (photoDetail ?? null);
  const isFavorite = !!photoDetail && photoDetail.rating >= favoriteMinRating;
  const isHidden = !!photoDetail?.hidden;
  // In the trash the same action restores the photo instead: trashing it
  // again was a no-op that reported "0 photos moved to trash".
  const inTrash = !!photoDetail?.in_trashcan;
  const isShared = !!photoDetail && !!photoShares?.some(share => share.photo_id === photoDetail.id);

  const toggleFavorite = useCallback(() => {
    if (photo) setFavorite({ image_hashes: [photo.image_hash], favorite: !isFavorite });
  }, [photo, isFavorite, setFavorite]);

  const toggleHidden = useCallback(() => {
    if (photo) setHidden({ image_hashes: [photo.image_hash], hidden: !photo.hidden });
  }, [photo, setHidden]);

  // A share link carries its own random slug, so it can be rotated or revoked
  // later; the old thumbnails_big URL came from the file content and could
  // never be withdrawn (issue #2028). It is independent of the photo's
  // "public" flag, which the bulk Make Public action still controls.
  const openShareLink = useCallback(() => {
    if (photo) setSharingPhotoId(photo.id);
  }, [photo]);
  const closeShareLink = useCallback(() => setSharingPhotoId(null), []);

  const toggleTrash = useCallback(() => {
    if (photo) {
      markDeleted(
        { image_hashes: [photo.image_hash], deleted: !photo.in_trashcan },
        { onSuccess: () => onAfterTrashToggle?.() }
      );
    }
  }, [photo, markDeleted, onAfterTrashToggle]);

  return {
    isFavorite,
    toggleFavorite,
    isHidden,
    toggleHidden,
    isShared,
    sharingPhotoId,
    openShareLink,
    closeShareLink,
    inTrash,
    toggleTrash,
  };
}

export type PhotoActions = ReturnType<typeof usePhotoActions>;
