import { IconTag as Tag } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFetchTagAlbumQuery } from "../../../api_client/tags/hooks";
import { validateMediaSearch } from "../../../components/photolist/mediaTypeFilter";
import type { EmptyStateConfig } from "../../../components/photolist/PhotoListView";
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

  // A tag outlives its last photo on purpose -- it can be created before
  // anything carries it, and deleting photos should not silently delete tags.
  // Without this the page rendered as a bare header with nothing under it.
  const emptyStateConfig: EmptyStateConfig = useMemo(
    () => ({
      icon: <Tag size={40} />,
      title: t("emptystate.tag.title"),
      description: t("emptystate.tag.description"),
      actionLabel: t("emptystate.tag.action"),
      actionLink: "/album/tags",
    }),
    [t]
  );

  return (
    <PhotoListView
      title={tagAlbum ? tagAlbum.name : t("loading")}
      loading={fetchingTagAlbum}
      icon={<Tag size={50} />}
      photoset={tagAlbum ? tagAlbum.grouped_photos : []}
      idx2hash={tagAlbum ? tagAlbum.grouped_photos.flatMap(el => el.items) : []}
      mediaType={mediaType}
      emptyStateConfig={emptyStateConfig}
      selectable
    />
  );
}

Route.update({ component: AlbumTagGallery });
