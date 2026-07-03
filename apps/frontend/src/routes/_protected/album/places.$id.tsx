import { IconMap as Map } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchPlaceAlbumQuery } from "../../../api_client/albums/hooks";
import { validateMediaSearch } from "../../../components/photolist/mediaTypeFilter";
import { PhotoListView } from "../../../components/photolist/PhotoListView";
import { useMediaTypeFilter } from "../../../components/photolist/useMediaTypeFilter";

export const Route = createFileRoute("/_protected/album/places/$id")({
  validateSearch: validateMediaSearch,
});

export function AlbumPlaceGallery() {
  const { t } = useTranslation();
  const { id: albumID } = Route.useParams();
  const mediaType = useMediaTypeFilter();
  const { data: album, isFetching } = useFetchPlaceAlbumQuery(albumID ?? "", mediaType);

  return (
    <PhotoListView
      title={album?.title ?? t("loading")}
      loading={isFetching}
      icon={<Map size={50} />}
      photoset={album?.grouped_photos ?? []}
      idx2hash={album?.grouped_photos.flatMap(el => el.items) ?? []}
      mediaType={mediaType}
      selectable
    />
  );
}

Route.update({ component: AlbumPlaceGallery });
