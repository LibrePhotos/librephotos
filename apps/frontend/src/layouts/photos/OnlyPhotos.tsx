import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Photo } from "tabler-icons-react";

import { fetchAlbumDate, fetchAlbumDateList } from "../../actions/albumsActions";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { PhotosState } from "../../reducers/photosReducer";
import { PhotosetType } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { updatePhotoGroups } from "./common";
import type { PhotoGroup } from "./common";

export function OnlyPhotos() {
  const { fetchedPhotosetType, photosFlat, photosGroupedByDate } = useAppSelector(state => state.photos as PhotosState);
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const [group, setGroup] = useState({} as PhotoGroup);

  useEffect(() => {
    if (group.id && group.page) {
      fetchAlbumDate(dispatch, {
        album_date_id: group.id,
        page: group.page,
        photosetType: PhotosetType.PHOTOS,
      });
    }
  }, [group.id, group.page]);

  useEffect(() => {
    if (fetchedPhotosetType !== PhotosetType.PHOTOS) {
      fetchAlbumDateList(dispatch, { photosetType: PhotosetType.PHOTOS });
    }
  }, [dispatch]); // Only run on first render

  return (
    <PhotoListView
      title={t("photos.photos")}
      loading={fetchedPhotosetType !== PhotosetType.PHOTOS}
      icon={<Photo size={50} />}
      photoset={photosGroupedByDate}
      updateGroups={updatePhotoGroups(setGroup)}
      idx2hash={photosFlat}
      selectable
    />
  );
}
