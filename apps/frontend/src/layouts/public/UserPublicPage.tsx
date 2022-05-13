import _ from "lodash";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchAlbumDate, fetchAlbumDateList } from "../../actions/albumsActions";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType } from "../../reducers/photosReducer";
import type { PhotosState } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../store/store";

type Props = {
  match: any;
};

type fetchedGroup = {
  id: string;
  page: number;
};

export function UserPublicPage(props: Props) {
  const { fetchedPhotosetType, photosFlat, photosGroupedByDate } = useAppSelector(state => state.photos as PhotosState);
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const { auth, ui } = useAppSelector(state => state);
  const [group, setGroup] = useState({} as fetchedGroup);

  useEffect(() => {
    if (group.id && group.page) {
      fetchAlbumDate(dispatch, {
        album_date_id: group.id,
        page: group.page,
        photosetType: PhotosetType.PUBLIC,
        username: props.match.params.username,
      });
    }
  }, [group.id, group.page]);

  useEffect(() => {
    fetchAlbumDateList(dispatch, {
      photosetType: PhotosetType.PUBLIC,
      username: props.match.params.username,
    });
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
    _.throttle(visibleItems => getAlbums(visibleItems), 500),
    []
  );

  return (
    <PhotoListView
      title={
        auth.access && auth.access.name === props.match.params.username
          ? "Your public photos"
          : `Public photos of ${props.match.params.username}`
      }
      loading={fetchedPhotosetType !== PhotosetType.PUBLIC}
      titleIconName="globe"
      isDateView
      photoset={photosGroupedByDate}
      idx2hash={photosFlat}
      isPublic={auth.access === null || auth.access.name !== props.match.params.username}
      updateGroups={throttledGetAlbums}
      selectable
    />
  );
}
