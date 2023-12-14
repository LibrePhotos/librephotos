import { IconUser as User } from "@tabler/icons-react";
import _ from "lodash";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { fetchAlbumDate, fetchAlbumDateList } from "../../actions/albumsActions";
import { useFetchPeopleAlbumsQuery } from "../../api_client/albums/people";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { PhotosState } from "../../reducers/photosReducer";
import { PhotosetType } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { updatePhotoGroups } from "../photos/common";

type IFetchedGroup = {
  id: string;
  page: number;
};

export function AlbumPersonGallery(): JSX.Element {
  const { albumID } = useParams();
  const { fetchedPhotosetType, photosFlat, photosGroupedByDate } = useAppSelector(state => state.photos as PhotosState);
  const { data: people } = useFetchPeopleAlbumsQuery();
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const [group, setGroup] = useState({} as IFetchedGroup);
  const person = people?.filter((i: any) => i.key === albumID)[0];
  const personname = person ? person.value : undefined;

  useEffect(() => {
    if (group.id && group.page) {
      fetchAlbumDate(dispatch, {
        album_date_id: group.id,
        page: group.page,
        photosetType: PhotosetType.PERSON,
        person_id: albumID ? +albumID : undefined,
      });
    }
  }, [group.id, group.page]);

  useEffect(() => {
    fetchAlbumDateList(dispatch, {
      photosetType: PhotosetType.PERSON,
      person_id: albumID ? +albumID : undefined,
    });
  }, [dispatch]); // Only run on first render

  const throttledGetAlbums = useCallback(
    _.throttle(visibleItems => updatePhotoGroups(setGroup)(visibleItems), 500),
    []
  );

  return (
    <PhotoListView
      title={personname || t("loading")}
      loading={fetchedPhotosetType !== PhotosetType.PERSON}
      icon={<User size={50} />}
      photoset={photosGroupedByDate}
      idx2hash={photosFlat}
      updateGroups={throttledGetAlbums}
      selectable
    />
  );
}
