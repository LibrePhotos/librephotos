import { IconStar as Star } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchDateAlbumQuery, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { Photoset, PigPhoto } from "../../api_client/photos/types";
import { mediaTypeToBulkQuery, validateMediaSearch } from "../../components/photolist/mediaTypeFilter";
import { EmptyStateConfig, PhotoGroup, PhotoListView } from "../../components/photolist/PhotoListView";
import { useMediaTypeFilter } from "../../components/photolist/useMediaTypeFilter";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";

export const Route = createFileRoute("/_protected/favorites")({
  component: FavoritePhotos,
  // The same All / Photos / Videos / Screenshots filter as search and the
  // albums, so e.g. favourite videos can be listed.
  validateSearch: validateMediaSearch,
});

function FavoritePhotos() {
  const { t } = useTranslation();
  const mediaType = useMediaTypeFilter();
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);

  const { data: photosGroupedByDate, isLoading } = useFetchDateAlbumsQuery({
    photosetType: Photoset.FAVORITES,
    mediaType,
  });

  useEffect(() => {
    if (photosGroupedByDate) setPhotosFlat(getPhotosFlatFromGroupedByDate(photosGroupedByDate));
  }, [photosGroupedByDate]);

  const [group, setGroup] = useState({} as PhotoGroup);
  useFetchDateAlbumQuery(
    { album_date_id: group.id, page: group.page, photosetType: Photoset.FAVORITES, mediaType },
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
      icon={<Star size={50} />}
      photoset={photosGroupedByDate ?? []}
      updateGroups={getAlbums}
      idx2hash={photosFlat}
      selectable
      // The "nothing here yet" card would be wrong when only the filter is empty.
      emptyStateConfig={mediaType === "all" ? emptyStateConfig : undefined}
      mediaType={mediaType}
      photosetQuery={{ favorite: true, ...mediaTypeToBulkQuery(mediaType) }}
    />
  );
}
