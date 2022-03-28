import { fetchNoTimestampPhotoPaginated } from "../../actions/photosActions";
import React, { useEffect, useCallback } from "react";
import _ from "lodash";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { PhotosState } from "../../reducers/photosReducer";
import { PhotosetType } from "../../reducers/photosReducer";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "../../store/store";

export const NoTimestampPhotosView = () => {
  const { fetchedPhotosetType, numberOfPhotos, photosFlat } = useAppSelector((state) => state.photos as PhotosState);
  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  useEffect(() => {
    if (fetchedPhotosetType !== PhotosetType.NO_TIMESTAMP) {
      fetchNoTimestampPhotoPaginated(dispatch, 1);
    }
  }, [dispatch]); // Only run on first render

  const getImages = (visibleItems: any) => {
    if (visibleItems.filter((i: any) => i.isTemp && i.isTemp != undefined).length > 0) {
      const firstTempObject = visibleItems.filter((i: any) => i.isTemp)[0];
      const page = Math.ceil((parseInt(firstTempObject.id) + 1) / 100);
      if (page > 1) {
        fetchNoTimestampPhotoPaginated(dispatch, page);
      }
    }
  };

  const throttledGetImages = useCallback(
    _.throttle((visibleItems) => getImages(visibleItems), 500),
    []
  );

  return (
    <PhotoListView
      title={t("photos.notimestamp")}
      loading={fetchedPhotosetType !== PhotosetType.NO_TIMESTAMP}
      titleIconName={"images outline"}
      isDateView={false}
      photoset={photosFlat}
      idx2hash={photosFlat}
      numberOfItems={numberOfPhotos}
      updateItems={throttledGetImages}
      selectable={true}
    />
  );
};
