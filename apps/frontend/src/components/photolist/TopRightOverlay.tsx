import type { PigPhoto } from "@librephotos/api-client";
import { Avatar } from "@mantine/core";
import { IconArchiveFilled as ArchiveFilled, IconStarFilled as StarFilled } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { FAVORITE_COLOR, ICON_SIZE } from "../../uiConstants";
import { isFavorite, ratesWithStars } from "../../util/rating";
import { sharerName } from "../sharing/sharerGroups";
import { TileBadge } from "./TileBadge";
import classes from "./TopRightOverlay.module.css";

// In stars mode a rated tile shows its star count; an unrated one nothing.
function RatingBadge({ rating }: Readonly<{ rating: number }>) {
  const { t } = useTranslation();
  const label = t("phototile.rating", { rating });
  return (
    <TileBadge role="img" aria-label={label} title={label}>
      {rating} ★
    </TileBadge>
  );
}

// An archived photo (#545) is off the timeline but still here: the mark says why it is missing there.
function ArchivedMark() {
  const { t } = useTranslation();
  const label = t("phototile.archived");
  return (
    <ArchiveFilled
      role="img"
      aria-label={label}
      title={label}
      size={ICON_SIZE.overlay}
      color="white"
      className={classes.archivedMark}
    />
  );
}

// Another user's photo, from a library they share with me (#2731): whose it is, so a mixed
// timeline is never ambiguous.
function OwnerMark({ item }: { item: PigPhoto }) {
  const { t } = useTranslation();
  const { data: userDetails } = useCurrentUserSelfDetailsQuery();
  const owner = item.owner;
  if (!owner || !userDetails || owner.id === userDetails.id) return null;
  const name = sharerName(owner, owner.username);
  const label = t("librarySharing.photoOf", { name });
  return (
    <Avatar
      size={22}
      radius="xl"
      name={name}
      color="initials"
      role="img"
      aria-label={label}
      title={label}
      className={classes.ownerMark}
    />
  );
}

export function TopRightOverlay({ item }: { item: PigPhoto }) {
  return (
    <>
      <OwnerMark item={item} />
      {item.archived && <ArchivedMark />}
      <RatingMark item={item} />
    </>
  );
}

function RatingMark({ item }: { item: PigPhoto }) {
  const { data: userDetails } = useCurrentUserSelfDetailsQuery();
  const { rating } = item;
  if (ratesWithStars(userDetails)) {
    return rating > 0 && <RatingBadge rating={rating} />;
  }
  // Same filled star as the lightbox. The shadow keeps it visible on light photos.
  return (
    isFavorite(rating, userDetails) && (
      <StarFilled
        size={ICON_SIZE.overlay}
        color={FAVORITE_COLOR}
        style={{ filter: "drop-shadow(0 0 1px var(--app-scrim-black-60))" }}
      />
    )
  );
}
