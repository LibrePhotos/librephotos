import React, { Component } from "react";
import { connect } from "react-redux";
import { Star } from "tabler-icons-react";

import { useAppSelector } from "../../store/store";

export const FavoritedOverlay = (item: any) => {
  const favorite_min_rating = useAppSelector(store => store.user.userSelfDetails.favorite_min_rating);

  return <span>{item.rating >= favorite_min_rating && <Star color="yellow" />}</span>;
};
