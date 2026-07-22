import { IconTag as Tag } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchTagAlbumQuery } from "../../../api_client/tags/hooks";
import { validateMediaSearch } from "../../../components/photolist/mediaTypeFilter";
import { PhotoListView } from "../../../components/photolist/PhotoListView";
import { useMediaTypeFilter } from "../../../components/photolist/useMediaTypeFilter";

export const Route = createFileRoute("/_protected/album/tags/$id")({
  validateSearch: validateMediaSearch,
});

export function AlbumTagGallery() {
  const { t } = useTranslation();
  const { id: tagID } = Route.useParams();
  const mediaType = useMediaTypeFilter();
  const { data: tagAlbum, isLoading: fetchingTagAlbum } = useFetchTagAlbumQuery(tagID || "", mediaType);

  return (
    <PhotoListView
      title={tagAlbum ? tagAlbum.name : t("loading")}
      loading={fetchingTagAlbum}
      icon={<Tag size={50} />}
      photoset={tagAlbum ? tagAlbum.grouped_photos : []}
      idx2hash={tagAlbum ? tagAlbum.grouped_photos.flatMap(el => el.items) : []}
      mediaType={mediaType}
      selectable
    />
  );
}

Route.update({ component: AlbumTagGallery });
