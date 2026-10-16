import type { Photo, User } from "@librephotos/api-client";
import { useCallback, useState } from "react";
import {
  useFetchPhotoSharesQuery,
  useMarkPhotosDeletedMutation,
  useSetFavoritePhotosMutation,
  useSetPhotosArchivedMutation,
  useSetPhotosHiddenMutation,
  useSetPhotosRatingMutation,
} from "../../api_client/photos/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { isFavorite as isFavoriteFor, ratesWithStars } from "../../util/rating";

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
 * photo page: favourite (or the star rating, #2202), hide, archive (#545), share link and trash, with their state. Each
 * action does nothing without details or for a viewer who is not the owner,
 * so a keyboard shortcut can call it blindly. The labels are each surface's
 * own: the lightbox names its shortcut keys, the page has none.
 */
export function usePhotoActions({ photoDetail, isPublic, onAfterTrashToggle }: Options) {
  const { data: userDetails } = useCurrentUserSelfDetailsQuery();
  const { mutate: setFavorite } = useSetFavoritePhotosMutation();
  const { mutate: setHidden } = useSetPhotosHiddenMutation();
  const { mutate: setArchived } = useSetPhotosArchivedMutation();
  const { mutate: markDeleted } = useMarkPhotosDeletedMutation();
  // Whether this photo has a live share link, for the share button's colour.
  const { data: photoShares } = useFetchPhotoSharesQuery(!isPublic);
  // The share link dialog is open while this holds the photo's id.
  const [sharingPhotoId, setSharingPhotoId] = useState<string | null>(null);

  const photo = isPublic ? null : (photoDetail ?? null);
  // No guessed threshold: nothing is a favorite until the user has loaded.
  const isFavorite = !!photoDetail && isFavoriteFor(photoDetail.rating, userDetails);
  const rating = useStarRating(photo, photoDetail, userDetails);
  const isHidden = !!photoDetail?.hidden;
  const isArchived = !!photoDetail?.archived;
  // In the trash the same action restores the photo instead: trashing it
  // again was a no-op that reported "0 photos moved to trash".
  const inTrash = !!photoDetail?.in_trashcan;
  const isShared = !!photoDetail && !!photoShares?.some(share => share.photo_id === photoDetail.id);
  // Rescan and face detection touch the files, so only the owner gets them (#2214, #524).
  const isOwner = ownsPhoto(photo, userDetails);

  // The favourite toggle (F) acts only in favourite mode: in stars mode its
  // un-favorite would set the rating to 0.
  const favoriteMode = userDetails !== undefined && !rating.ratesWithStars;
  const toggleFavorite = useCallback(() => {
    if (photo && favoriteMode) setFavorite({ image_hashes: [photo.image_hash], favorite: !isFavorite });
  }, [photo, favoriteMode, isFavorite, setFavorite]);

  const toggleHidden = useCallback(() => {
    if (photo) setHidden({ image_hashes: [photo.image_hash], hidden: !photo.hidden });
  }, [photo, setHidden]);

  const toggleArchived = useCallback(() => {
    if (photo) setArchived({ image_hashes: [photo.image_hash], archived: !photo.archived });
  }, [photo, setArchived]);

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
    ...rating,
    isHidden,
    toggleHidden,
    isArchived,
    toggleArchived,
    isShared,
    sharingPhotoId,
    openShareLink,
    closeShareLink,
    inTrash,
    toggleTrash,
    isOwner,
  };
}

export type PhotoActions = ReturnType<typeof usePhotoActions>;

function ownsPhoto(photo: Photo | null, user: User | undefined): photo is Photo {
  return photo !== null && user !== undefined && photo.owner.id === user.id;
}

/**
 * The 0-5 star rating in stars mode (#2202): whether the user rates with
 * stars, the rating to show (the one being saved, until the details have it;
 * a failed save falls back to the stored one), and the setter, which acts only
 * on the owner's own photo in stars mode.
 */
function useStarRating(photo: Photo | null, photoDetail: Photo | null | undefined, user: User | undefined) {
  const { mutate, isPending, variables } = useSetPhotosRatingMutation();
  const stars = ratesWithStars(user);
  const canRate = stars && ownsPhoto(photo, user);
  const imageHash = photoDetail?.image_hash;
  const pending = isPending && variables?.image_hashes[0] === imageHash ? variables?.rating : undefined;
  const setRating = useCallback(
    (value: number) => {
      if (canRate && imageHash !== undefined) mutate({ image_hashes: [imageHash], rating: value });
    },
    [canRate, imageHash, mutate]
  );
  return { ratesWithStars: stars, canRate, rating: pending ?? photoDetail?.rating ?? 0, setRating };
}
