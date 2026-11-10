import { Photoset } from "@librephotos/api-client";
import { IconScreenshot as Screenshot } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useDateAlbumDayPages, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { useListFailure } from "../../components/common/useListFailure";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { EmptyStateConfig } from "../../components/photolist/PhotoListView";
import { validatePhotoSearch } from "../../components/photolist/photoSearch";
import { useGroupedPhotos } from "../../components/photolist/useGroupedPhotos";
import { useScanEmptyStateAction } from "../../components/photolist/useScanEmptyStateAction";

export const Route = createFileRoute("/_protected/screenshots")({
  component: OnlyScreenshots,
  validateSearch: validatePhotoSearch,
});

function OnlyScreenshots() {
  const { t } = useTranslation();

  const photosQuery = useFetchDateAlbumsQuery({ photosetType: Photoset.SCREENSHOTS });
  const { data: photosGroupedByDate, isLoading } = photosQuery;
  const listFailure = useListFailure(photosQuery);

  const { groups, photosFlat } = useGroupedPhotos(photosGroupedByDate);

  // Pig reports the day groups on screen; their placeholders name the pages still to load.
  const getAlbums = useDateAlbumDayPages({ photosetType: Photoset.SCREENSHOTS });

  const emptyAction = useScanEmptyStateAction(t("emptystate.screenshots.description"));
  const emptyStateConfig: EmptyStateConfig = useMemo(
    () => ({
      icon: <Screenshot size={40} />,
      title: t("emptystate.screenshots.title"),
      ...emptyAction,
    }),
    [t, emptyAction]
  );

  return (
    <PhotoListView
      title={t("photos.screenshots")}
      loading={isLoading}
      photoset={groups}
      updateGroups={getAlbums}
      idx2hash={photosFlat}
      selectable
      emptyStateConfig={emptyStateConfig}
      error={listFailure}
      photosetQuery={{ is_screenshot: true }}
    />
  );
}
