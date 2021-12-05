import React, { useEffect } from "react";
import { fetchRecentlyAddedPhotos } from "../../actions/photosActions";
import _ from "lodash";
import moment from "moment";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType, PhotosState } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { useTranslation } from "react-i18next";

export const RecentlyAddedPhotos = () => {
  const { fetchedPhotosetType, photosFlat, recentlyAddedPhotosDate } = useAppSelector((state) => state.photos as PhotosState);
  const dispatch = useAppDispatch();
  const {t} = useTranslation();

  useEffect(() => {
    if (fetchedPhotosetType !== PhotosetType.RECENTLY_ADDED) {
      fetchRecentlyAddedPhotos(dispatch);
    }
  }, [dispatch]); // Only run on first render

  return (
    <PhotoListView
        title={t("photos.recentlyadded")}
        loading={fetchedPhotosetType !== PhotosetType.RECENTLY_ADDED}
        titleIconName={"clock"}
        isDateView={false}
        date={
          moment(recentlyAddedPhotosDate).format(
            "MMM Do YYYY, dddd"
          ) !== "Invalid date"
            ? moment(recentlyAddedPhotosDate).format(
                "MMM Do YYYY, dddd"
              )
            : recentlyAddedPhotosDate
        }
        photoset={photosFlat}
        idx2hash={photosFlat}
        dayHeaderPrefix={t("photos.addedon")}
        selectable={true}
      />
  );
}
