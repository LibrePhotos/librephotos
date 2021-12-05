import React, { useEffect } from "react";
import { fetchFavoritePhotos } from "../../actions/photosActions";
import _ from "lodash";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType, PhotosState } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { useTranslation } from "react-i18next";

export const FavoritePhotos = () => {
  const { fetchedPhotosetType, photosFlat, photosGroupedByDate } = useAppSelector((state) => state.photos as PhotosState);
  const dispatch = useAppDispatch();
  const {t} = useTranslation();

  useEffect(() => {
    if (fetchedPhotosetType !== PhotosetType.FAVORITES) {
      fetchFavoritePhotos(dispatch);
    }
  }, [dispatch]); // Only run on first render

  return (
    <PhotoListView
      showHidden={false}
      title={t("photos.favorite")}
      loading={fetchedPhotosetType !== PhotosetType.FAVORITES}
      titleIconName={"star"}
      isDateView={true}
      photoset={photosGroupedByDate}
      idx2hash={photosFlat}
      selectable={true}
    />
  );
}
