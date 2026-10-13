import type { PigPhoto } from "@librephotos/api-client";
import { IconStarFilled as StarFilled } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { FAVORITE_COLOR, ICON_SIZE } from "../../uiConstants";
import { isFavorite, ratesWithStars } from "../../util/rating";
import { TileBadge } from "./TileBadge";

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

export function TopRightOverlay({ item }: { item: PigPhoto }) {
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
