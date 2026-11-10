import { Photoset } from "@librephotos/api-client";
import { IconPhoto as Photo } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useDateAlbumDayPages, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { useListFailure } from "../../components/common/useListFailure";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { EmptyStateConfig } from "../../components/photolist/PhotoListView";
import { validatePhotoSearch } from "../../components/photolist/photoSearch";
import { useGroupedPhotos } from "../../components/photolist/useGroupedPhotos";
import { useHasNoScanDirectory } from "../../components/photolist/useScanEmptyStateAction";

export const Route = createFileRoute("/_protected/photos")({
  component: OnlyPhotos,
  validateSearch: validatePhotoSearch,
});

function OnlyPhotos() {
  const { t } = useTranslation();
  // Only an admin can set a user's scan folder, so "Go to Library" would be a
  // dead end; point at what others shared instead.
  const hasNoScanDirectory = useHasNoScanDirectory();

  const photosQuery = useFetchDateAlbumsQuery({ photosetType: Photoset.PHOTOS });
  const { data: photosGroupedByDate, isLoading } = photosQuery;
  const listFailure = useListFailure(photosQuery);

  const { groups, photosFlat } = useGroupedPhotos(photosGroupedByDate);

  // Pig reports the day groups on screen; their placeholders name the pages still to load.
  const getAlbums = useDateAlbumDayPages({ photosetType: Photoset.PHOTOS });

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
      photoset={groups}
      updateGroups={getAlbums}
      idx2hash={photosFlat}
      selectable
      emptyStateConfig={emptyStateConfig}
      error={listFailure}
      photosetQuery={{ photo: true }}
    />
  );
}
