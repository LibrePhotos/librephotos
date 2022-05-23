import React from "react";
import { Star } from "tabler-icons-react";

import { useAppSelector } from "../../store/store";

export const FavoritedOverlay = (item: any) => {
  const { favorite_min_rating } = useAppSelector(store => store.user.userSelfDetails);
  return item.item.rating >= favorite_min_rating && <Star strokeWidth={3} style={{ marginRight: 4 }} color="#FFD700" />;
};
