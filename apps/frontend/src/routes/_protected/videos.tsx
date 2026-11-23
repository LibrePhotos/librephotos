import { Photoset } from "@librephotos/api-client";
import { IconVideo as Video } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useDateAlbumDayPages, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { useSearchPhotosQuery } from "../../api_client/search/hooks";
import { usePhotoOrder } from "../../api_client/user/hooks/usePhotoOrder";
import { useListFailure } from "../../components/common/useListFailure";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { EmptyStateConfig } from "../../components/photolist/PhotoListView";
import { validatePhotoSearch } from "../../components/photolist/photoSearch";
import { isSizeSort } from "../../components/photolist/photoSort";
import { PhotoSortMenu } from "../../components/photolist/PhotoSortMenu";
import { useGroupedPhotos } from "../../components/photolist/useGroupedPhotos";
import { usePhotoSort } from "../../components/photolist/usePhotoSort";
import { useScanEmptyStateAction } from "../../components/photolist/useScanEmptyStateAction";
import { STORAGE_KEYS } from "../../util/storage";

export const Route = createFileRoute("/_protected/videos")({
  component: OnlyVideos,
  validateSearch: validatePhotoSearch,
});

function OnlyVideos() {
  const { t } = useTranslation();
  const { order: photoOrder } = usePhotoOrder();
  const photoSort = usePhotoSort(STORAGE_KEYS.photoSortVideos, photoOrder);
  const { sort } = photoSort;
  const sizeSort = isSizeSort(sort);

  const photosQuery = useFetchDateAlbumsQuery(
    { photosetType: Photoset.VIDEOS, order: sort === "oldest" ? "oldest" : "newest" },
    { skip: sizeSort }
  );
  const sizeQuery = useSearchPhotosQuery("", "videos", {}, sort, { sizeSortWithoutTerm: true });
  const { data: photosGroupedByDate, isLoading } = photosQuery;
  const listFailure = useListFailure(sizeSort ? sizeQuery : photosQuery);

  const { groups, photosFlat } = useGroupedPhotos(photosGroupedByDate);
  const flat = sizeSort ? (sizeQuery.data?.photosFlat ?? []) : photosFlat;

  const getAlbums = useDateAlbumDayPages(
    { photosetType: Photoset.VIDEOS, order: sort === "oldest" ? "oldest" : "newest" },
    { skip: sizeSort }
  );

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
      loading={sizeSort ? sizeQuery.isPending : isLoading}
      photoset={sizeSort ? flat : groups}
      updateGroups={sizeSort ? undefined : getAlbums}
      idx2hash={flat}
      selectable
      emptyStateConfig={emptyStateConfig}
      error={listFailure}
      photosetQuery={{ video: true }}
      sort={sort}
      sortTotal={sizeSort ? sizeQuery.data?.count : undefined}
      headerActions={
        <PhotoSortMenu
          sort={sort}
          onChange={photoSort.setSort}
          onReset={photoSort.explicit ? photoSort.reset : undefined}
        />
      }
    />
  );
}
