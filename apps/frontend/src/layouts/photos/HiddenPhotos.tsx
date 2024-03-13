import { IconEyeOff as EyeOff } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { PigPhoto } from "../../actions/photosActions.types";
import { useFetchDateAlbumQuery, useFetchDateAlbumsQuery } from "../../api_client/albums/date";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType } from "../../reducers/photosReducer";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";
import type { PhotoGroup } from "./common";

export function HiddenPhotos() {
  const { t } = useTranslation();
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);

  const { data: photosGroupedByDate, isLoading } = useFetchDateAlbumsQuery({ photosetType: PhotosetType.HIDDEN });

  useEffect(() => {
    if (photosGroupedByDate) setPhotosFlat(getPhotosFlatFromGroupedByDate(photosGroupedByDate));
  }, [photosGroupedByDate]);

  const [group, setGroup] = useState({} as PhotoGroup);
  useFetchDateAlbumQuery(
    { album_date_id: group.id, page: group.page, photosetType: PhotosetType.HIDDEN },
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
      title={t("photos.hidden")}
      loading={isLoading}
      icon={<EyeOff size={50} />}
      photoset={photosGroupedByDate ?? []}
      updateGroups={getAlbums}
      idx2hash={photosFlat}
      selectable
    />
  );
}
