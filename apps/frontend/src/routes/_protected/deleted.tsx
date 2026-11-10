import { Photoset } from "@librephotos/api-client";
import { Text } from "@mantine/core";
import { IconTrash as Trash } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useDateAlbumDayPages, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { useListFailure } from "../../components/common/useListFailure";
import { mediaTypeToBulkQuery, validateMediaSearch } from "../../components/photolist/mediaTypeFilter";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { EmptyStateConfig } from "../../components/photolist/PhotoListView";
import { useGroupedPhotos } from "../../components/photolist/useGroupedPhotos";
import { useMediaTypeFilter } from "../../components/photolist/useMediaTypeFilter";
import { EmptyTrashButton, useTrashCounts } from "../../components/trash/EmptyTrashButton";

export const Route = createFileRoute("/_protected/deleted")({
  component: DeletedPhotos,
  // The media filter (?media=videos): "select all, delete permanently" then
  // reaches only the photos it shows.
  validateSearch: validateMediaSearch,
});

function DeletedPhotos() {
  const { t } = useTranslation();
  const mediaType = useMediaTypeFilter();

  const photosQuery = useFetchDateAlbumsQuery({ photosetType: Photoset.IN_TRASHCAN, mediaType });
  const { data: photosGroupedByDate, isLoading } = photosQuery;
  const listFailure = useListFailure(photosQuery);
  const trash = useTrashCounts();
  // The media filter only where it can narrow something: a trash without videos is all photos. A
  // filter already set (a link to ?media=videos) keeps it, so it can be cleared.
  const mediaFilter = mediaType !== "all" || (trash.videos ?? 0) > 0 ? mediaType : undefined;
  // Days a photo stays in the trash (#2203); 0, or a server without the setting: until emptied.
  const retentionDays = useGetSettingsQuery().data?.trash_retention_days ?? 0;

  const { groups, photosFlat } = useGroupedPhotos(photosGroupedByDate);

  // Pig reports the day groups on screen; their placeholders name the pages still to load.
  const getAlbums = useDateAlbumDayPages({ photosetType: Photoset.IN_TRASHCAN, mediaType });

  const emptyStateConfig: EmptyStateConfig = useMemo(
    () => ({
      icon: <Trash size={40} />,
      title: t("emptystate.deleted.title"),
      description:
        retentionDays > 0
          ? t("emptystate.deleted.descriptionretention", { count: retentionDays })
          : t("emptystate.deleted.description"),
    }),
    [t, retentionDays]
  );

  return (
    <PhotoListView
      title={t("photos.deleted")}
      loading={isLoading}
      additionalSubHeader={
        <Text size="sm" c="dimmed">
          {retentionDays > 0 ? t("trash.retentionOn", { count: retentionDays }) : t("trash.retentionOff")}
        </Text>
      }
      // Empty trash, left of Select and in the ⋯: the whole trash, whatever the media filter shows;
      // it waits for the job it starts.
      headerActions={<EmptyTrashButton total={trash.total} shownCount={photosFlat.length} />}
      photoset={groups}
      updateGroups={getAlbums}
      idx2hash={photosFlat}
      selectable
      // "Trash is empty" would be wrong when only the filter matches nothing.
      emptyStateConfig={mediaType === "all" ? emptyStateConfig : undefined}
      error={listFailure}
      mediaType={mediaFilter}
      photosetQuery={{ in_trashcan: true, ...mediaTypeToBulkQuery(mediaType) }}
    />
  );
}
