import { IconStar as Star } from "@tabler/icons-react";
import React from "react";

import { PigPhoto } from "../../actions/photosActions.types";
import { useAppSelector } from "../../store/store";

export function FavoritedOverlay({ item }: { item: PigPhoto }) {
  const { favorite_min_rating: favoriteMinRating } = useAppSelector(store => store.user.userSelfDetails);
  const { rating } = item;
  return rating >= favoriteMinRating && <Star strokeWidth={3} style={{ marginRight: 4 }} color="#FFD700" />;
}
