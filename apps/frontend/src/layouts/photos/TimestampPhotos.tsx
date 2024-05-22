import { IconPhoto as Photo } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { PigPhoto } from "../../actions/photosActions.types";
import { useFetchDateAlbumQuery, useFetchDateAlbumsQuery } from "../../api_client/albums/date";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType } from "../../reducers/photosReducer";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";
import { AppShellProtected } from "../AppShellProtected";
import type { PhotoGroup } from "./common";

export function TimestampPhotos() {
  const { t } = useTranslation();
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);

  const { data: photosGroupedByDate, isLoading } = useFetchDateAlbumsQuery({ photosetType: PhotosetType.NONE });

  useEffect(() => {
    if (photosGroupedByDate) setPhotosFlat(getPhotosFlatFromGroupedByDate(photosGroupedByDate));
  }, [photosGroupedByDate]);

  const [group, setGroup] = useState({} as PhotoGroup);
  useFetchDateAlbumQuery(
    { album_date_id: group.id, page: group.page, photosetType: PhotosetType.NONE },
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
    <AppShellProtected>
      <PhotoListView
        title={t("photos.photos")}
        loading={isLoading}
        icon={<Photo size={50} />}
        photoset={photosGroupedByDate ?? []}
        idx2hash={photosFlat}
        updateGroups={getAlbums}
        selectable
      />
    </AppShellProtected>
  );
}
