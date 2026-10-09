import { IconTags as Tags } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchThingsAlbumQuery } from "../../../api_client/albums/hooks";
import { albumNotFoundState } from "../../../components/album/albumNotFound";
import { validateMediaSearch } from "../../../components/photolist/mediaTypeFilter";
import { PhotoListView } from "../../../components/photolist/PhotoListView";
import { useMediaTypeFilter } from "../../../components/photolist/useMediaTypeFilter";

export const Route = createFileRoute("/_protected/album/things/$id")({
  component: AlbumThingGallery,
  validateSearch: validateMediaSearch,
});

function AlbumThingGallery() {
  const { t } = useTranslation();
  const { id: albumID } = Route.useParams();
  const mediaType = useMediaTypeFilter();
  const {
    data: groupedPhotos,
    isLoading: fetchingAlbumsThing,
    isError,
  } = useFetchThingsAlbumQuery(albumID || "", mediaType);
  // A failed background refetch also sets isError, with the album still on screen
  const notFound = isError && !groupedPhotos;

  return (
    <PhotoListView
      title={groupedPhotos ? groupedPhotos.title : notFound ? t("things") : t("loading")}
      loading={fetchingAlbumsThing}
      emptyStateConfig={notFound ? albumNotFoundState(t, <Tags size={40} />, "/album/things") : undefined}
      icon={<Tags size={50} />}
      photoset={groupedPhotos ? groupedPhotos.grouped_photos : []}
      idx2hash={groupedPhotos ? groupedPhotos.grouped_photos.flatMap(el => el.items) : []}
      // No photo filter for an album that is not there
      mediaType={notFound ? undefined : mediaType}
      selectable
    />
  );
}
