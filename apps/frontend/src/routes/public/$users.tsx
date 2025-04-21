import { createFileRoute } from '@tanstack/react-router'
import { IconGlobe as Globe } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useLoaderData } from "@tanstack/react-router";

import { PigPhoto, Photoset } from "../../api_client/photos/types"; 
import { useFetchDateAlbumQuery, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";
import type { PhotoGroup } from "../../layouts/photos/common";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";

export const Route = createFileRoute('/public/$users')({
  component: UserPublicPage, 
})

export function UserPublicPage() {
  const { users } = Route.useParams()
  const { data: currentUser } = useCurrentUserSelfDetailsQuery();

  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);

  const { data: photosGroupedByDate, isLoading } = useFetchDateAlbumsQuery({
    photosetType: Photoset.PUBLIC,
    username: users,
  });

  useEffect(() => {
    if (photosGroupedByDate) setPhotosFlat(getPhotosFlatFromGroupedByDate(photosGroupedByDate));
  }, [photosGroupedByDate]);

  const [group, setGroup] = useState({} as PhotoGroup);
  useFetchDateAlbumQuery(
    { album_date_id: group.id, page: group.page, photosetType: Photoset.PUBLIC, username: users },
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
      // To-Do: Translate this
      title={
        currentUser?.username === users
          ? "Your public photos"
          : `Public photos of ${users}`
      }
      loading={isLoading}
      icon={<Globe size={50} />}
      photoset={photosGroupedByDate ?? []}
      idx2hash={photosFlat}
      isPublic={currentUser?.username !== users}
      updateGroups={getAlbums}
      selectable
    />
  );
}
