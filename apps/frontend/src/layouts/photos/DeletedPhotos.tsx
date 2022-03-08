import React, { useEffect, useCallback, useState } from "react";
import { fetchAlbumDate, fetchAlbumDateList } from "../../actions/albumsActions";
import _ from "lodash";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType, PhotosState } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { useTranslation } from "react-i18next";

type fetchedGroup = {
  id: string;
  page: number;
};

export const DeletedPhotos = () => {
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
        photosetType: PhotosetType.DELETED,
      });
    }
  }, [group.id, group.page]);

  useEffect(() => {
    if (fetchedPhotosetType !== PhotosetType.DELETED) {
      fetchAlbumDateList(dispatch, { photosetType: PhotosetType.DELETED });
    }
  }, [dispatch]); // Only run on first render

  const getAlbums = (visibleGroups: any) => {
    console.log("visibleGroups", visibleGroups);
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
      showHidden={false}
      title={t("photos.deleted")}
      loading={fetchedPhotosetType !== PhotosetType.DELETED}
      titleIconName={"trash"}
      isDateView={true}
      photoset={photosGroupedByDate}
      updateGroups={throttledGetAlbums}
      idx2hash={photosFlat}
      selectable={true}
    />
  );
};
