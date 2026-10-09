import { IconPhoto as Photo } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchDateAlbumQuery, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { Photoset, PigPhoto } from "../../api_client/photos/types";
import { NO_PHOTO_GROUP } from "../../components/photolist/photoGroup";
import { EmptyStateConfig, PhotoListView } from "../../components/photolist/PhotoListView";
import { useHasNoScanDirectory } from "../../components/photolist/useScanEmptyStateAction";
import type { PigVisibleGroup } from "../../components/react-pig";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";

export const Route = createFileRoute("/_protected/photos")({
  component: OnlyPhotos,
});

function OnlyPhotos() {
  const { t } = useTranslation();
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);
  // Only an admin can set a user's scan folder, so "Go to Library" would be a
  // dead end; point at what others shared instead.
  const hasNoScanDirectory = useHasNoScanDirectory();

  const { data: photosGroupedByDate, isLoading } = useFetchDateAlbumsQuery({ photosetType: Photoset.PHOTOS });

  useEffect(() => {
    if (photosGroupedByDate) setPhotosFlat(getPhotosFlatFromGroupedByDate(photosGroupedByDate));
  }, [photosGroupedByDate]);

  const [group, setGroup] = useState(NO_PHOTO_GROUP);
  useFetchDateAlbumQuery(
    { album_date_id: group.id, page: group.page, photosetType: Photoset.PHOTOS },
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

  const emptyStateConfig: EmptyStateConfig = useMemo(
    () =>
      hasNoScanDirectory
        ? {
            icon: <Photo size={40} />,
            title: t("emptystate.photos.title"),
            description: t("emptystate.photos.noscandirectory"),
            actionLabel: t("sidemenu.sharedwithyou"),
            actionLink: "/sharing/withme/albums",
          }
        : {
            icon: <Photo size={40} />,
            title: t("emptystate.photos.title"),
            description: t("emptystate.photos.description"),
            actionLabel: t("emptystate.goToLibrary"),
            actionLink: "/library",
          },
    [t, hasNoScanDirectory]
  );

  return (
    <PhotoListView
      // "Photos only": "/" is titled "Photos" too, and includes videos.
      title={t("mediafilter.photos")}
      loading={isLoading}
      icon={<Photo size={50} />}
      photoset={photosGroupedByDate ?? []}
      updateGroups={getAlbums}
      idx2hash={photosFlat}
      selectable
      emptyStateConfig={emptyStateConfig}
      photosetQuery={{ photo: true }}
    />
  );
}
