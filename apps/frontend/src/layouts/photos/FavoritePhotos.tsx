import React, { useEffect } from "react";
import { useDispatch } from "react-redux";
import { fetchFavoritePhotos } from "../../actions/photosActions";
import _ from "lodash";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType, PhotosState } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../hooks";

export const FavoritePhotos = () => {
  const { fetchedPhotosetType, photosFlat, photosGroupedByDate } = useAppSelector((state) => state.photos as PhotosState);
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (fetchedPhotosetType !== PhotosetType.FAVORITES) {
      fetchFavoritePhotos(dispatch);
    }
  }, [dispatch]); // Only run on first render

  return (
    <PhotoListView
      showHidden={false}
      title={"Favorite Photos"}
      loading={fetchedPhotosetType !== PhotosetType.FAVORITES}
      titleIconName={"star"}
      isDateView={true}
      photoset={photosGroupedByDate}
      idx2hash={photosFlat}
      selectable={true}
    />
  );
}
