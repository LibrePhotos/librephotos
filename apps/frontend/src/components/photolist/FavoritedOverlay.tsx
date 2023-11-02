import React from "react";
import { Star } from "tabler-icons-react";

import { useAppSelector } from "../../store/store";

export function FavoritedOverlay(item: any) {
  const { favorite_min_rating: rating } = useAppSelector(store => store.user.userSelfDetails);
  return item.item.rating >= rating && <Star strokeWidth={3} style={{ marginRight: 4 }} color="#FFD700" />;
}
