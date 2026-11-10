import { Photoset } from "@librephotos/api-client";
import { IconArchive as Archive } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useDateAlbumDayPages, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { useListFailure } from "../../components/common/useListFailure";
import { mediaTypeToBulkQuery, validateMediaSearch } from "../../components/photolist/mediaTypeFilter";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { EmptyStateConfig } from "../../components/photolist/PhotoListView";
import { useGroupedPhotos } from "../../components/photolist/useGroupedPhotos";
import { useMediaTypeFilter } from "../../components/photolist/useMediaTypeFilter";

// The Archive (#545): photos taken off the timeline and Memories, which stay in albums, people,
// places and search. Unarchive in the selection menu puts them back on the timeline.
export const Route = createFileRoute("/_protected/archived")({
  component: ArchivedPhotos,
  // The same All / Photos / Videos / Screenshots filter as the Hidden page.
  validateSearch: validateMediaSearch,
});

function ArchivedPhotos() {
  const { t } = useTranslation();
  const mediaType = useMediaTypeFilter();

  const photosQuery = useFetchDateAlbumsQuery({
    photosetType: Photoset.ARCHIVED,
    mediaType,
  });
  const { data: photosGroupedByDate, isLoading } = photosQuery;
  const listFailure = useListFailure(photosQuery);

  const { groups, photosFlat } = useGroupedPhotos(photosGroupedByDate);

  // Pig reports the day groups on screen; their placeholders name the pages still to load.
  const getAlbums = useDateAlbumDayPages({ photosetType: Photoset.ARCHIVED, mediaType });

  const emptyStateConfig: EmptyStateConfig = useMemo(
    () => ({
      icon: <Archive size={40} />,
      title: t("emptystate.archived.title"),
      description: t("emptystate.archived.description"),
    }),
    [t]
  );

  return (
    <PhotoListView
      title={t("photos.archived")}
      loading={isLoading}
      photoset={groups}
      updateGroups={getAlbums}
      idx2hash={photosFlat}
      selectable
      // The "nothing here yet" card would be wrong when only the filter is empty.
      emptyStateConfig={mediaType === "all" ? emptyStateConfig : undefined}
      error={listFailure}
      mediaType={mediaType}
      photosetQuery={{ archived: true, ...mediaTypeToBulkQuery(mediaType) }}
    />
  );
}
