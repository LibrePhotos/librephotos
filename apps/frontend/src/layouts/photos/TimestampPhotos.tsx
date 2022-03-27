import React, { useEffect, useState, useCallback } from "react";
import { fetchAlbumDateList, fetchAlbumDate } from "../../actions/albumsActions";
import _ from "lodash";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType, PhotosState } from "../../reducers/photosReducer";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "../../store/store";

type fetchedGroup = {
  id: string;
  page: number;
};

export const TimestampPhotos = () => {
  const { fetchedPhotosetType, photosFlat, photosGroupedByDate } = useAppSelector(
    (state) => state.photos as PhotosState
  );
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const [group, setGroup] = useState({} as fetchedGroup);

  useEffect(() => {
    if (group.id && group.page) {
      fetchAlbumDate(dispatch, {
        album_date_id: group.id,
        page: group.page,
        photosetType: PhotosetType.TIMESTAMP,
      });
    }
  }, [group.id, group.page]);

  useEffect(() => {
    if (fetchedPhotosetType !== PhotosetType.TIMESTAMP) {
      fetchAlbumDateList(dispatch, { photosetType: PhotosetType.TIMESTAMP });
    }
  }, [dispatch]); // Only run on first render

  const getAlbums = (visibleGroups: any) => {
    visibleGroups.forEach((group: any) => {
      var visibleImages = group.items;
      if (visibleImages.filter((i: any) => i.isTemp && i.isTemp != undefined).length > 0) {
        var firstTempObject = visibleImages.filter((i: any) => i.isTemp)[0];
        var page = Math.ceil((parseInt(firstTempObject.id) + 1) / 100);
        setGroup({ id: group.id, page: page });
      }
    });
  };

  const throttledGetAlbums = useCallback(
    _.throttle((visibleItems) => getAlbums(visibleItems), 500),
    []
  );

  return (
    <PhotoListView
      title={t("photos.photos")}
      loading={fetchedPhotosetType !== PhotosetType.TIMESTAMP}
      titleIconName={"images"}
      isDateView={true}
      photoset={photosGroupedByDate}
      idx2hash={photosFlat}
      updateGroups={throttledGetAlbums}
      selectable={true}
    />
  );
};
