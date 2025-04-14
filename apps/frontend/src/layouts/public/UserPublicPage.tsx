import { IconGlobe as Globe } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { PigPhoto } from "../../api_client/photos/types"; 
import { useFetchDateAlbumQuery, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { Photoset } from  "../../api_client/photos/types";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";
import type { PhotoGroup } from "../photos/common";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";

export function UserPublicPage() {
  const params = useParams();
  const { data: currentUser } = useCurrentUserSelfDetailsQuery();

  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);

  const { data: photosGroupedByDate, isLoading } = useFetchDateAlbumsQuery({
    photosetType: Photoset.PUBLIC,
    username: params.username,
  });

  useEffect(() => {
    if (photosGroupedByDate) setPhotosFlat(getPhotosFlatFromGroupedByDate(photosGroupedByDate));
  }, [photosGroupedByDate]);

  const [group, setGroup] = useState({} as PhotoGroup);
  useFetchDateAlbumQuery(
    { album_date_id: group.id, page: group.page, photosetType: Photoset.PUBLIC, username: params.username },
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
        currentUser?.username === params.username
          ? "Your public photos"
          : `Public photos of ${params.username}`
      }
      loading={isLoading}
      icon={<Globe size={50} />}
      photoset={photosGroupedByDate ?? []}
      idx2hash={photosFlat}
      isPublic={currentUser?.username !== params.username}
      updateGroups={getAlbums}
      selectable
    />
  );
}
