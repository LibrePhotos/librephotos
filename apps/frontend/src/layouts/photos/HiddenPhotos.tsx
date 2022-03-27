import React, { useEffect } from "react";
import { fetchHiddenPhotos } from "../../actions/photosActions";

import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { PhotosState } from "../../reducers/photosReducer";
import { PhotosetType } from "../../reducers/photosReducer";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "../../store/store";

export const HiddenPhotos = () => {
  const { fetchedPhotosetType, photosFlat, photosGroupedByDate } = useAppSelector(
    (state) => state.photos as PhotosState
  );
  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  useEffect(() => {
    if (fetchedPhotosetType !== PhotosetType.HIDDEN) {
      fetchHiddenPhotos(dispatch);
    }
  }, [dispatch]); // Only run on first render

  return (
    <PhotoListView
      showHidden={true}
      title={t("photos.hidden")}
      loading={fetchedPhotosetType !== PhotosetType.HIDDEN}
      titleIconName={"hide"}
      isDateView={true}
      photoset={photosGroupedByDate}
      idx2hash={photosFlat}
      selectable={true}
    />
  );
};
