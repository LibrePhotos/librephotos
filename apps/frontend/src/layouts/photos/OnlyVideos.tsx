import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Star } from "tabler-icons-react";

import { fetchAlbumDate, fetchAlbumDateList } from "../../actions/albumsActions";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { PhotosState } from "../../reducers/photosReducer";
import { PhotosetType } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../store/store";

type FetchedGroup = {
  id: string;
  page: number;
};

export function OnlyVideos() {
  const { fetchedPhotosetType, photosFlat, photosGroupedByDate } = useAppSelector(state => state.photos as PhotosState);
  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  const [group, setGroup] = useState({} as FetchedGroup);

  useEffect(() => {
    if (group.id && group.page) {
      fetchAlbumDate(dispatch, {
        album_date_id: group.id,
        page: group.page,
        photosetType: PhotosetType.VIDEOS,
      });
    }
  }, [group.id, group.page]);

  useEffect(() => {
    if (fetchedPhotosetType !== PhotosetType.VIDEOS) {
      fetchAlbumDateList(dispatch, { photosetType: PhotosetType.VIDEOS });
    }
  }, [dispatch]); // Only run on first render

  const getAlbums = (visibleGroups: any) => {
    visibleGroups.forEach((group: any) => {
      const visibleImages = group.items;
      if (visibleImages.filter((i: any) => i.isTemp && i.isTemp !== undefined).length > 0) {
        const firstTempObject = visibleImages.filter((i: any) => i.isTemp)[0];
        const page = Math.ceil((parseInt(firstTempObject.id,10) + 1) / 100);
        setGroup({ id: group.id, page: page });
      }
    });
  };

  return (
    <PhotoListView
      title={t("photos.videos")}
      loading={fetchedPhotosetType !== PhotosetType.VIDEOS}
      icon={<Star size={50} />}
      photoset={photosGroupedByDate}
      updateGroups={getAlbums}
      idx2hash={photosFlat}
      selectable
    />
  );
}
