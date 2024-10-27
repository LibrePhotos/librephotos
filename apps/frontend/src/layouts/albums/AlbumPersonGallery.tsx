import { IconUser as User } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { PigPhoto } from "../../actions/photosActions.types";
import { useFetchDateAlbumQuery, useFetchDateAlbumsQuery } from "../../api_client/albums/date";
import { Person, useFetchPeopleAlbumsQuery } from "../../api_client/albums/people";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType } from "../../reducers/photosReducer";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";
import type { PhotoGroup } from "../photos/common";

export function AlbumPersonGallery(): JSX.Element {
  const { albumID } = useParams();
  const { t } = useTranslation();
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);
  const { data: people } = useFetchPeopleAlbumsQuery();

  const person = people?.filter((i: Person) => i.id === albumID)[0];
  const personname = person ? person.name : undefined;

  const { data: photosGroupedByDate, isLoading } = useFetchDateAlbumsQuery({
    photosetType: PhotosetType.PERSON,
    person_id: albumID ? +albumID : undefined,
  });

  useEffect(() => {
    if (photosGroupedByDate) setPhotosFlat(getPhotosFlatFromGroupedByDate(photosGroupedByDate));
  }, [photosGroupedByDate]);

  const [group, setGroup] = useState({} as PhotoGroup);
  useFetchDateAlbumQuery(
    {
      album_date_id: group.id,
      page: group.page,
      photosetType: PhotosetType.PERSON,
      person_id: albumID ? +albumID : undefined,
    },
    { skip: !group.id }
  );

  const getAlbums = (visibleGroups: any) => {
    visibleGroups.reverse().forEach((photoGroup: any) => {
      const visibleImages = photoGroup.items;
      if (visibleImages.filter((i: any) => i.isTemp).length > 0) {
        const firstTempObject = visibleImages.filter((i: any) => i.isTemp)[0];
        const page = Math.ceil((parseInt(firstTempObject.id, 10) + 1) / 100);

        setGroup({ id: photoGroup.id, page });
      }
    });
  };

  return (
    <PhotoListView
      title={personname || t("loading")}
      loading={isLoading}
      icon={<User size={50} />}
      photoset={photosGroupedByDate ?? []}
      idx2hash={photosFlat}
      updateGroups={getAlbums}
      selectable
    />
  );
}
