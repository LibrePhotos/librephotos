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

export const FavoritePhotos = () => {
  const { fetchedPhotosetType, photosFlat, photosGroupedByDate } =
    useAppSelector((state) => state.photos as PhotosState);
  const { userSelfDetails } = useAppSelector((state) => state.user);
  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  useEffect(() => {
    console.log(userSelfDetails.favorite_min_rating);
    if (fetchedPhotosetType !== PhotosetType.FAVORITES) {
      fetchDateAlbumsList(dispatch, PhotosetType.FAVORITES, true);
    }
  }, [dispatch]); // Only run on first render

  const getAlbums = (visibleGroups: any) => {
    console.log("visibleGroups", visibleGroups);
    visibleGroups.forEach((group: any) => {
      var visibleImages = group.items;
      if (
        visibleImages.filter((i: any) => i.isTemp && i.isTemp != undefined)
          .length > 0
      ) {
        var firstTempObject = visibleImages.filter((i: any) => i.isTemp)[0];
        var page = Math.ceil((parseInt(firstTempObject.id) + 1) / 100);
        fetchAlbumsDateGalleries(dispatch, group.id, page, true);
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
