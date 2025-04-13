import { IconStar as Star } from "@tabler/icons-react";
import React from "react";

import { PigPhoto } from "../../api_client/photos/photosActions.types";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";

export function FavoritedOverlay({ item }: { item: PigPhoto }) {
  const { data: userDetails } = useCurrentUserSelfDetailsQuery();
  const favoriteMinRating = userDetails?.favorite_min_rating ?? 4;
  const { rating } = item;
  return rating >= favoriteMinRating && <Star strokeWidth={3} style={{ marginRight: 4 }} color="#FFD700" />;
}
