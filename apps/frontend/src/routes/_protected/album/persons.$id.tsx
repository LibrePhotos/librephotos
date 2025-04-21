import { createFileRoute } from '@tanstack/react-router'


import { IconUser as User } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Photoset, PigPhoto } from "../../../api_client/photos/types";
import { useFetchDateAlbumQuery, useFetchDateAlbumsQuery } from "../../../api_client/albums/hooks";
import { Person, useFetchPeopleAlbumsQuery } from "../../../api_client/albums/hooks";
import { PhotoListView, PhotoGroup } from "../../../components/photolist/PhotoListView";
import { getPhotosFlatFromGroupedByDate } from "../../../util/util";

export const Route = createFileRoute('/_protected/album/persons/$id')({
  component: AlbumPersonGallery,
})

export function AlbumPersonGallery(): JSX.Element {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);
  const { data: people } = useFetchPeopleAlbumsQuery();

  const person = people?.filter((i: Person) => i.id === id)[0];
  const personname = person ? person.name : undefined;

  const { data: photosGroupedByDate, isLoading } = useFetchDateAlbumsQuery({
    photosetType: Photoset.PERSON,
    person_id: id ? +id : undefined,
  });

  useEffect(() => {
    if (photosGroupedByDate) setPhotosFlat(getPhotosFlatFromGroupedByDate(photosGroupedByDate));
  }, [photosGroupedByDate]);

  const [group, setGroup] = useState({} as PhotoGroup);
  useFetchDateAlbumQuery(
    {
      album_date_id: group.id,
      page: group.page,
      photosetType: Photoset.PERSON,
      person_id: id ? +id : undefined,
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
