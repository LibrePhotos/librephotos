import _ from "lodash";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { User } from "tabler-icons-react";

import { fetchAlbumDate, fetchAlbumDateList } from "../../actions/albumsActions";
import { fetchPeople } from "../../actions/peopleActions";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { PhotosState } from "../../reducers/photosReducer";
import { PhotosetType } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../store/store";

type IFetchedGroup = {
  id: string;
  page: number;
};

export function AlbumPersonGallery(): JSX.Element {
  const { albumID, ...params } = useParams();
  const { fetchedPhotosetType, photosFlat, photosGroupedByDate } = useAppSelector(state => state.photos as PhotosState);
  const { people } = useAppSelector(state => state.people);
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const [group, setGroup] = useState({} as IFetchedGroup);
  const person = people.filter((i: any) => i.key === albumID)[0];
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
    if (people.length === 0) {
      fetchPeople(dispatch);
    }
    fetchAlbumDateList(dispatch, {
      photosetType: PhotosetType.PERSON,
      person_id: albumID ? +albumID : undefined,
    });
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

  const throttledGetAlbums = useCallback(
    _.throttle(visibleItems => getAlbums(visibleItems), 500),
    []
  );

  // get person details
  return (
    <PhotoListView
      title={personname || t("loading")}
      loading={fetchedPhotosetType !== PhotosetType.PERSON}
      icon={<User size={50} />}
      isDateView
      photoset={photosGroupedByDate}
      idx2hash={photosFlat}
      updateGroups={throttledGetAlbums}
      selectable
      params={params}
    />
  );
}
