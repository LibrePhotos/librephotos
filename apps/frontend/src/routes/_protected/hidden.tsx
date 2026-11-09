import type { PigPhoto } from "@librephotos/api-client";
import { Photoset } from "@librephotos/api-client";
import { IconEyeOff as EyeOff } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDateAlbumDayPages, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { useListFailure } from "../../components/common/useListFailure";
import { mediaTypeToBulkQuery, validateMediaSearch } from "../../components/photolist/mediaTypeFilter";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { EmptyStateConfig } from "../../components/photolist/PhotoListView";
import { useMediaTypeFilter } from "../../components/photolist/useMediaTypeFilter";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";

export const Route = createFileRoute("/_protected/hidden")({
  component: HiddenPhotos,
  // The same All / Photos / Videos / Screenshots filter as search and the
  // albums, so e.g. hidden videos can be listed.
  validateSearch: validateMediaSearch,
});

function HiddenPhotos() {
  const { t } = useTranslation();
  const mediaType = useMediaTypeFilter();
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);

  const photosQuery = useFetchDateAlbumsQuery({
    photosetType: Photoset.HIDDEN,
    mediaType,
  });
  const { data: photosGroupedByDate, isLoading } = photosQuery;
  const listFailure = useListFailure(photosQuery);

  useEffect(() => {
    if (photosGroupedByDate) setPhotosFlat(getPhotosFlatFromGroupedByDate(photosGroupedByDate));
  }, [photosGroupedByDate]);

  // Pig reports the day groups on screen; their placeholders name the pages still to load.
  const getAlbums = useDateAlbumDayPages({ photosetType: Photoset.HIDDEN, mediaType });

  const emptyStateConfig: EmptyStateConfig = useMemo(
    () => ({
      icon: <EyeOff size={40} />,
      title: t("emptystate.hidden.title"),
      description: t("emptystate.hidden.description"),
    }),
    [t]
  );

  return (
    <PhotoListView
      title={t("photos.hidden")}
      loading={isLoading}
      photoset={photosGroupedByDate ?? []}
      updateGroups={getAlbums}
      idx2hash={photosFlat}
      selectable
      // The "nothing here yet" card would be wrong when only the filter is empty.
      emptyStateConfig={mediaType === "all" ? emptyStateConfig : undefined}
      error={listFailure}
      mediaType={mediaType}
      photosetQuery={{ hidden: true, ...mediaTypeToBulkQuery(mediaType) }}
    />
  );
}
