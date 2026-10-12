import { IconStarFilled as StarFilled } from "@tabler/icons-react";
import React from "react";
import type { PigPhoto } from "../../api_client/photos/types";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { FAVORITE_COLOR, ICON_SIZE } from "../../uiConstants";

export function TopRightOverlay({ item }: { item: PigPhoto }) {
  const { data: userDetails } = useCurrentUserSelfDetailsQuery();
  const favoriteMinRating = userDetails?.favorite_min_rating ?? 4;
  const { rating } = item;
  // Same filled star as the lightbox. The shadow keeps it visible on light photos.
  return (
    rating >= favoriteMinRating && (
      <StarFilled
        size={ICON_SIZE.overlay}
        color={FAVORITE_COLOR}
        style={{ filter: "drop-shadow(0 0 1px rgba(0, 0, 0, 0.6))" }}
      />
    )
  );
}

// Keep backward compatibility alias
