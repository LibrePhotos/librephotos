import React, { useCallback, useEffect, useState } from "react";
import { fetchAlbumDate, fetchAlbumDateList } from "../../actions/albumsActions";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { PhotosState } from "../../reducers/photosReducer";
import { PhotosetType } from "../../reducers/photosReducer";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { throttle } from "lodash";

type fetchedGroup = {
  id: string;
  page: number;
};

export const FavoritePhotos = () => {
  const { fetchedPhotosetType, photosFlat, photosGroupedByDate } = useAppSelector(
    (state) => state.photos as PhotosState
  );
  const { userSelfDetails } = useAppSelector((state) => state.user);
  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  const [group, setGroup] = useState({} as fetchedGroup);

  useEffect(() => {
    if (group.id && group.page) {
      fetchAlbumDate(dispatch, {
        album_date_id: group.id,
        page: group.page,
        photosetType: PhotosetType.FAVORITES,
      });
    }
  }, [group.id, group.page]);

  useEffect(() => {
    if (fetchedPhotosetType !== PhotosetType.FAVORITES) {
      fetchAlbumDateList(dispatch, { photosetType: PhotosetType.FAVORITES });
    }
  }, [dispatch]); // Only run on first render

  const getAlbums = (visibleGroups: any) => {
    console.log("visibleGroups", visibleGroups);
    visibleGroups.forEach((group: any) => {
      const visibleImages = group.items;
      if (visibleImages.filter((i: any) => i.isTemp && i.isTemp != undefined).length > 0) {
        const firstTempObject = visibleImages.filter((i: any) => i.isTemp)[0];
        const page = Math.ceil((parseInt(firstTempObject.id) + 1) / 100);
        setGroup({ id: group.id, page: page });
      }
    });
  };

  const throttledGetAlbums = useCallback(
    throttle((visibleItems) => getAlbums(visibleItems), 500),
    []
  );
  return (
    <PhotoListView
      showHidden={false}
      title={t("photos.favorite")}
      loading={fetchedPhotosetType !== PhotosetType.FAVORITES}
      titleIconName={"star"}
      isDateView={true}
      photoset={photosGroupedByDate}
      updateGroups={throttledGetAlbums}
      idx2hash={photosFlat}
      selectable={true}
    />
  );
};
