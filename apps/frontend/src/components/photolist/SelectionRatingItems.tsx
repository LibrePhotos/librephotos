import type { PigPhoto } from "@librephotos/api-client";
import { Menu } from "@mantine/core";
import { IconStar as Star, IconStarOff as StarOff } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSetFavoritePhotosMutation, useSetPhotosRatingMutation } from "../../api_client/photos/hooks";
import type { PhotoSelection } from "../../api_client/photos/photoSelection";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { ICON_SIZE } from "../../uiConstants";
import { isFavorite, ratesWithStars, RATINGS_HIGHEST_FIRST } from "../../util/rating";
import { DisabledReason } from "../common/DisabledReason";
import { MenuSubmenu } from "../common/MenuSubmenu";
import { pairFor, type Pair } from "./SelectionVisibilityItems";

type Props = Readonly<{
  /** Why the items are off (nothing selected), or false while they work. */
  disabledReason: string | false;
  selectAllMode: boolean;
  /** The selected photos, read when an item is clicked. */
  selection: () => PhotoSelection;
  /** The selected tiles (the exclusions after Select all), for which of Favorite and Unfavorite to offer. */
  selectedItems: readonly PigPhoto[];
  /** Called after a request was sent, to end the selection. */
  onDone: () => void;
}>;

type FavoriteProps = Omit<Props, "selectAllMode" | "selectedItems"> & Readonly<{ favorite: Pair }>;

function FavoriteItems({ disabledReason, selection, favorite, onDone }: FavoriteProps) {
  const { t } = useTranslation();
  const setFavoritePhotos = useSetFavoritePhotosMutation();
  const setFavorite = (on: boolean) => {
    setFavoritePhotos.mutate({ ...selection(), favorite: on });
    onDone();
  };
  return (
    <>
      {favorite !== "off" && (
        <DisabledReason reason={disabledReason} position="left">
          <Menu.Item leftSection={<Star size={ICON_SIZE.menu} />} onClick={() => setFavorite(true)}>
            {t("selectionactions.favorite")}
          </Menu.Item>
        </DisabledReason>
      )}
      {favorite !== "on" && (
        <DisabledReason reason={disabledReason} position="left">
          <Menu.Item leftSection={<StarOff size={ICON_SIZE.menu} />} onClick={() => setFavorite(false)}>
            {t("selectionactions.unfavorite")}
          </Menu.Item>
        </DisabledReason>
      )}
    </>
  );
}

function ratingLabel(t: TFunction, rating: number) {
  return rating === 0 ? t("selectionactions.norating") : t("selectionactions.ratingstars", { count: rating });
}

// "Set rating" with 5 to 1 stars and No rating. The server rates photos by
// hash only, so after Select all the item is disabled and says why.
function RatingSubmenu({ disabledReason, selectAllMode, selection, onDone }: Props) {
  const { t } = useTranslation();
  const setPhotosRating = useSetPhotosRatingMutation();
  const reason = selectAllMode ? t("selectionactions.setratingselectall") : disabledReason;
  const rate = (rating: number) => {
    const photos = selection();
    if (photos.select_all) return;
    setPhotosRating.mutate({ image_hashes: photos.image_hashes, rating });
    onDone();
  };
  return (
    <MenuSubmenu label={t("selectionactions.setrating")} icon={<Star size={ICON_SIZE.menu} />} reason={reason}>
      {RATINGS_HIGHEST_FIRST.map(rating => (
        <Menu.Item key={rating} onClick={() => rate(rating)}>
          {ratingLabel(t, rating)}
        </Menu.Item>
      ))}
    </MenuSubmenu>
  );
}

/**
 * The selection menu's rating actions (#2202): Favorite or Unfavorite (both
 * while the selection's favorites are not known) in favorite mode, a "Set
 * rating" submenu in stars mode, which never calls
 * /photosedit/favorite/ (its Unfavorite sets the rating to 0).
 */
export function SelectionRatingItems(props: Props) {
  const { data: user } = useCurrentUserSelfDetailsQuery();
  if (ratesWithStars(user)) return <RatingSubmenu {...props} />;
  const { selectAllMode, selectedItems, ...items } = props;
  // Not known after Select all, nor before the user's favorite threshold has loaded.
  const favorite = selectAllMode
    ? "both"
    : pairFor(
        selectedItems.filter(item => !item.isTemp).map(item => (user ? isFavorite(item.rating, user) : undefined))
      );
  return <FavoriteItems {...items} favorite={favorite} />;
}
