import React, { useEffect, useCallback } from "react";
import {
  fetchDateAlbumsList,
  fetchAlbumsDateGalleries,
} from "../../actions/albumsActions";
import _ from "lodash";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType, PhotosState } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { useTranslation } from "react-i18next";

export const TimestampPhotos = () => {
  const { fetchedPhotosetType, photosFlat, photosGroupedByDate } = useAppSelector((state) => state.photos as PhotosState);
  const dispatch = useAppDispatch();
  const {t} = useTranslation();

  useEffect(() => {
    if (fetchedPhotosetType !== PhotosetType.TIMESTAMP) {
      fetchDateAlbumsList(dispatch);
    }
  }, [dispatch]); // Only run on first render

  const getAlbums = (visibleGroups: any) => {
    visibleGroups.forEach((group : any) => {
      if (group.incomplete === true) {
        (fetchAlbumsDateGalleries(dispatch, group.id));
      }
    });
  };

  const throttledGetAlbums = useCallback(_.throttle(visibleItems => getAlbums(visibleItems), 500),[]);

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
}