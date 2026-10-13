import { Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconStar as Star, IconStarOff as StarOff } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSetFavoritePhotosMutation, useSetPhotosRatingMutation } from "../../api_client/photos/hooks";
import type { PhotoSelection } from "../../api_client/photos/photoSelection";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { ICON_SIZE } from "../../uiConstants";
import { ratesWithStars, RATINGS_HIGHEST_FIRST } from "../../util/rating";
import { DisabledReason } from "../common/DisabledReason";

type Props = Readonly<{
  /** Why the items are off (nothing selected), or false while they work. */
  disabledReason: string | false;
  selectAllMode: boolean;
  /** The selected photos, read when an item is clicked. */
  selection: () => PhotoSelection;
  /** Called after a request was sent, to end the selection. */
  onDone: () => void;
}>;

type FavoriteProps = Omit<Props, "selectAllMode">;

function FavoriteItems({ disabledReason, selection, onDone }: FavoriteProps) {
  const { t } = useTranslation();
  const setFavoritePhotos = useSetFavoritePhotosMutation();
  const setFavorite = (favorite: boolean) => {
    setFavoritePhotos.mutate({ ...selection(), favorite });
    onDone();
  };
  return (
    <>
      <DisabledReason reason={disabledReason} position="left">
        <Menu.Item leftSection={<Star size={ICON_SIZE.menu} />} onClick={() => setFavorite(true)}>
          {t("selectionactions.favorite")}
        </Menu.Item>
      </DisabledReason>
      <DisabledReason reason={disabledReason} position="left">
        <Menu.Item leftSection={<StarOff size={ICON_SIZE.menu} />} onClick={() => setFavorite(false)}>
          {t("selectionactions.unfavorite")}
        </Menu.Item>
      </DisabledReason>
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
  // Opens on hover, and on a tap too: a phone has no hover.
  const [opened, { open, close }] = useDisclosure(false);
  const icon = <Star size={ICON_SIZE.menu} />;
  const reason = selectAllMode ? t("selectionactions.setratingselectall") : disabledReason;
  if (reason) {
    return (
      <DisabledReason reason={reason} position="left">
        <Menu.Item leftSection={icon}>{t("selectionactions.setrating")}</Menu.Item>
      </DisabledReason>
    );
  }
  const rate = (rating: number) => {
    const photos = selection();
    if (photos.select_all) return;
    setPhotosRating.mutate({ image_hashes: photos.image_hashes, rating });
    onDone();
  };
  return (
    <Menu.Sub opened={opened} onChange={isOpen => (isOpen ? open() : close())}>
      <Menu.Sub.Target>
        <Menu.Sub.Item leftSection={icon} onClick={open}>
          {t("selectionactions.setrating")}
        </Menu.Sub.Item>
      </Menu.Sub.Target>
      <Menu.Sub.Dropdown>
        {RATINGS_HIGHEST_FIRST.map(rating => (
          <Menu.Item key={rating} onClick={() => rate(rating)}>
            {ratingLabel(t, rating)}
          </Menu.Item>
        ))}
      </Menu.Sub.Dropdown>
    </Menu.Sub>
  );
}

/**
 * The selection menu's rating actions (#2202): Favorite / Unfavorite in
 * favorite mode, a "Set rating" submenu in stars mode, which never calls
 * /photosedit/favorite/ (its Unfavorite sets the rating to 0).
 */
export function SelectionRatingItems(props: Props) {
  const { data: user } = useCurrentUserSelfDetailsQuery();
  return ratesWithStars(user) ? <RatingSubmenu {...props} /> : <FavoriteItems {...props} />;
}
