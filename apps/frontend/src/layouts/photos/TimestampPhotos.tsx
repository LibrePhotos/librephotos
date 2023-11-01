import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Photo } from "tabler-icons-react";

import { fetchAlbumDate, fetchAlbumDateList } from "../../actions/albumsActions";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { PhotosState } from "../../reducers/photosReducer";
import { PhotosetType } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../store/store";
import type { PhotoGroup } from "./common";

export function TimestampPhotos() {
  const { fetchedPhotosetType, photosFlat, photosGroupedByDate } = useAppSelector(state => state.photos as PhotosState);
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const [group, setGroup] = useState({} as PhotoGroup);
  useEffect(() => {
    if (group.id && group.page) {
      fetchAlbumDate(dispatch, {
        album_date_id: group.id,
        page: group.page,
        photosetType: PhotosetType.TIMESTAMP,
      });
    }
  }, [dispatch, group.id, group.page]);

  useEffect(() => {
    if (fetchedPhotosetType !== PhotosetType.TIMESTAMP) {
      fetchAlbumDateList(dispatch, { photosetType: PhotosetType.TIMESTAMP });
    }
  }, [dispatch]);

  const getAlbums = (visibleGroups: any) => {
    visibleGroups.reverse().forEach((group: any) => {
      const visibleImages = group.items;
      if (visibleImages.filter((i: any) => i.isTemp).length > 0) {
        const firstTempObject = visibleImages.filter((i: any) => i.isTemp)[0];
        const page = Math.ceil((parseInt(firstTempObject.id, 10) + 1) / 100);
        setGroup({ id: group.id, page: page });
      }
    });
  };

  return (
    <PhotoListView
      title={t("photos.photos")}
      loading={fetchedPhotosetType !== PhotosetType.TIMESTAMP}
      icon={<Photo size={50} />}
      photoset={photosGroupedByDate}
      idx2hash={photosFlat}
      updateGroups={getAlbums}
      selectable
    />
  );
}
