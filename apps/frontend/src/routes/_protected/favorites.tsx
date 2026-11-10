import { Photoset } from "@librephotos/api-client";
import { IconStar as Star } from "@tabler/icons-react";
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

export const Route = createFileRoute("/_protected/favorites")({
  component: FavoritePhotos,
  // The same All / Photos / Videos / Screenshots filter as search and the
  // albums, so e.g. favourite videos can be listed.
  validateSearch: validateMediaSearch,
});

function FavoritePhotos() {
  const { t } = useTranslation();
  const mediaType = useMediaTypeFilter();

  const photosQuery = useFetchDateAlbumsQuery({
    photosetType: Photoset.FAVORITES,
    mediaType,
  });
  const { data: photosGroupedByDate, isLoading } = photosQuery;
  const listFailure = useListFailure(photosQuery);

  const { groups, photosFlat } = useGroupedPhotos(photosGroupedByDate);

  // Pig reports the day groups on screen; their placeholders name the pages still to load.
  const getAlbums = useDateAlbumDayPages({ photosetType: Photoset.FAVORITES, mediaType });

  const emptyStateConfig: EmptyStateConfig = useMemo(
    () => ({
      icon: <Star size={40} />,
      title: t("emptystate.favorites.title"),
      description: t("emptystate.favorites.description"),
    }),
    [t]
  );

  return (
    <PhotoListView
      title={t("photos.favorite")}
      loading={isLoading}
      photoset={groups}
      updateGroups={getAlbums}
      idx2hash={photosFlat}
      selectable
      // The "nothing here yet" card would be wrong when only the filter is empty.
      emptyStateConfig={mediaType === "all" ? emptyStateConfig : undefined}
      error={listFailure}
      mediaType={mediaType}
      photosetQuery={{ favorite: true, ...mediaTypeToBulkQuery(mediaType) }}
    />
  );
}
