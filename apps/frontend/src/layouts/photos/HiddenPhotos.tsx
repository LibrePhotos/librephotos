import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EyeOff } from "tabler-icons-react";

import { fetchAlbumDate, fetchAlbumDateList } from "../../actions/albumsActions";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { PhotosState } from "../../reducers/photosReducer";
import { PhotosetType } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../store/store";

type fetchedGroup = {
  id: string;
  page: number;
};

export function HiddenPhotos() {
  const { fetchedPhotosetType, photosFlat, photosGroupedByDate } = useAppSelector(state => state.photos as PhotosState);
  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  const [group, setGroup] = useState({} as fetchedGroup);

  useEffect(() => {
    if (group.id && group.page) {
      fetchAlbumDate(dispatch, {
        album_date_id: group.id,
        page: group.page,
        photosetType: PhotosetType.HIDDEN,
      });
    }
  }, [group.id, group.page]);

  useEffect(() => {
    if (fetchedPhotosetType !== PhotosetType.HIDDEN) {
      fetchAlbumDateList(dispatch, { photosetType: PhotosetType.HIDDEN });
    }
  }, [dispatch]); // Only run on first render

  const getAlbums = (visibleGroups: any) => {
    visibleGroups.forEach((group: any) => {
      const visibleImages = group.items;
      if (visibleImages.filter((i: any) => i.isTemp && i.isTemp != undefined).length > 0) {
        const firstTempObject = visibleImages.filter((i: any) => i.isTemp)[0];
        const page = Math.ceil((parseInt(firstTempObject.id) + 1) / 100);
        setGroup({ id: group.id, page: page });
      }
    });
  };

  return (
    <PhotoListView
      title={t("photos.hidden")}
      loading={fetchedPhotosetType !== PhotosetType.HIDDEN}
      icon={<EyeOff size={50} />}
      photoset={photosGroupedByDate}
      updateGroups={getAlbums}
      idx2hash={photosFlat}
      selectable
    />
  );
}
