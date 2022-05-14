import _ from "lodash";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { User } from "tabler-icons-react";

import { fetchAlbumDate, fetchAlbumDateList } from "../../actions/albumsActions";
import { fetchPeople } from "../../actions/peopleActions";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosState, PhotosetType } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../store/store";

type fetchedGroup = {
  id: string;
  page: number;
};

type Props = {
  match: any;
};

export function AlbumPersonGallery(props: Props): JSX.Element {
  const { fetchedPhotosetType, photosFlat, photosGroupedByDate } = useAppSelector(state => state.photos as PhotosState);
  const { people } = useAppSelector(state => state.people);
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const [group, setGroup] = useState({} as fetchedGroup);
  const person = people.filter((i: any) => i.key == props.match.params.albumID)[0];
  const personname = person ? person.value : undefined;

  useEffect(() => {
    if (group.id && group.page) {
      fetchAlbumDate(dispatch, {
        album_date_id: group.id,
        page: group.page,
        photosetType: PhotosetType.PERSON,
        person_id: props.match.params.albumID,
      });
    }
  }, [group.id, group.page]);

  useEffect(() => {
    if (people.length == 0) {
      fetchPeople(dispatch);
    }
    fetchAlbumDateList(dispatch, {
      photosetType: PhotosetType.PERSON,
      person_id: props.match.params.albumID,
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
      match={props.match}
    />
  );
}
