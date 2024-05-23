import { IconGlobe as Globe } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { PigPhoto } from "../../actions/photosActions.types";
import { useFetchDateAlbumQuery, useFetchDateAlbumsQuery } from "../../api_client/albums/date";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType } from "../../reducers/photosReducer";
import { useAppSelector } from "../../store/store";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";
import type { PhotoGroup } from "../photos/common";

export function UserPublicPage() {
  const params = useParams();
  const { auth } = useAppSelector(state => state);

  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);

  const { data: photosGroupedByDate, isLoading } = useFetchDateAlbumsQuery({
    photosetType: PhotosetType.PUBLIC,
    username: params.username,
  });

  useEffect(() => {
    if (photosGroupedByDate) setPhotosFlat(getPhotosFlatFromGroupedByDate(photosGroupedByDate));
  }, [photosGroupedByDate]);

  const [group, setGroup] = useState({} as PhotoGroup);
  useFetchDateAlbumQuery(
    { album_date_id: group.id, page: group.page, photosetType: PhotosetType.PUBLIC, username: params.username },
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
        auth.access && auth.access.name === params.username
          ? "Your public photos"
          : `Public photos of ${params.username}`
      }
      loading={isLoading}
      icon={<Globe size={50} />}
      photoset={photosGroupedByDate ?? []}
      idx2hash={photosFlat}
      isPublic={auth.access === null || auth.access.name !== params.username}
      updateGroups={getAlbums}
      selectable
    />
  );
}
