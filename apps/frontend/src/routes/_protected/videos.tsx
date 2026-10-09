import { IconVideo as Video } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchDateAlbumQuery, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { Photoset, PigPhoto } from "../../api_client/photos/types";
import { NO_PHOTO_GROUP } from "../../components/photolist/photoGroup";
import { EmptyStateConfig, PhotoListView } from "../../components/photolist/PhotoListView";
import { useScanEmptyStateAction } from "../../components/photolist/useScanEmptyStateAction";
import type { PigVisibleGroup } from "../../components/react-pig";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";

export const Route = createFileRoute("/_protected/videos")({
  component: OnlyVideos,
});

function OnlyVideos() {
  const { t } = useTranslation();
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);

  const { data: photosGroupedByDate, isLoading } = useFetchDateAlbumsQuery({ photosetType: Photoset.VIDEOS });

  useEffect(() => {
    if (photosGroupedByDate) setPhotosFlat(getPhotosFlatFromGroupedByDate(photosGroupedByDate));
  }, [photosGroupedByDate]);

  const [group, setGroup] = useState(NO_PHOTO_GROUP);
  useFetchDateAlbumQuery(
    { album_date_id: group.id, page: group.page, photosetType: Photoset.VIDEOS },
    { skip: !group.id }
  );

  const getAlbums = (visibleGroups: PigVisibleGroup<PigPhoto>[]) => {
    visibleGroups.reverse().forEach(photoGroup => {
      const visibleImages = photoGroup.items;
      if (visibleImages.filter(i => i.isTemp).length > 0) {
        const firstTempObject = visibleImages.filter(i => i.isTemp)[0];
        const page = Math.ceil((parseInt(firstTempObject.id, 10) + 1) / 100);

        setGroup({ id: photoGroup.id, page });
      }
    });
  };

  const emptyAction = useScanEmptyStateAction(t("emptystate.videos.description"));
  const emptyStateConfig: EmptyStateConfig = useMemo(
    () => ({
      icon: <Video size={40} />,
      title: t("emptystate.videos.title"),
      ...emptyAction,
    }),
    [t, emptyAction]
  );

  return (
    <PhotoListView
      title={t("photos.videos")}
      loading={isLoading}
      icon={<Video size={50} />}
      photoset={photosGroupedByDate ?? []}
      updateGroups={getAlbums}
      idx2hash={photosFlat}
      selectable
      emptyStateConfig={emptyStateConfig}
      photosetQuery={{ video: true }}
    />
  );
}
