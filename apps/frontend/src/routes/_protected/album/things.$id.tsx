import { IconTags as Tags } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchThingsAlbumQuery } from "../../../api_client/albums/hooks";
import { validateMediaSearch } from "../../../components/photolist/mediaTypeFilter";
import { PhotoListView } from "../../../components/photolist/PhotoListView";
import { useMediaTypeFilter } from "../../../components/photolist/useMediaTypeFilter";

export const Route = createFileRoute("/_protected/album/things/$id")({
  validateSearch: validateMediaSearch,
});

export function AlbumThingGallery() {
  const { t } = useTranslation();
  const { id: albumID } = Route.useParams();
  const mediaType = useMediaTypeFilter();
  const { data: groupedPhotos, isLoading: fetchingAlbumsThing } = useFetchThingsAlbumQuery(albumID || "", mediaType);

  return (
    <PhotoListView
      title={groupedPhotos ? groupedPhotos.title : t("loading")}
      loading={fetchingAlbumsThing}
      icon={<Tags size={50} />}
      photoset={groupedPhotos ? groupedPhotos.grouped_photos : []}
      idx2hash={groupedPhotos ? groupedPhotos.grouped_photos.flatMap(el => el.items) : []}
      mediaType={mediaType}
      selectable
    />
  );
}

Route.update({ component: AlbumThingGallery });
