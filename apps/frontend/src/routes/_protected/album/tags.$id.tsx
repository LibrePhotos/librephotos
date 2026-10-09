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
  component: AlbumTagGallery,
  validateSearch: validateMediaSearch,
});

function AlbumTagGallery() {
  const { t } = useTranslation();
  const { id: tagID } = Route.useParams();
  const mediaType = useMediaTypeFilter();
  const { data: tagAlbum, isLoading: fetchingTagAlbum, isError } = useFetchTagAlbumQuery(tagID || "", mediaType);
  // A failed background refetch also sets isError, with the tag still on screen
  const notFound = isError && !tagAlbum;

  // A tag outlives its last photo on purpose -- it can be created before
  // anything carries it, and deleting photos should not silently delete tags.
  // Without this the page rendered as a bare header with nothing under it.
  const emptyStateConfig: EmptyStateConfig = useMemo(
    () => ({
      icon: <Tag size={40} />,
      // A deleted (or merged away) tag is not an empty one
      title: t(notFound ? "emptystate.tagnotfound.title" : "emptystate.tag.title"),
      description: t(notFound ? "emptystate.tagnotfound.description" : "emptystate.tag.description"),
      actionLabel: t("emptystate.tag.action"),
      actionLink: "/album/tags",
    }),
    [t, notFound]
  );

  return (
    <PhotoListView
      title={tagAlbum ? tagAlbum.name : notFound ? t("tags") : t("loading")}
      loading={fetchingTagAlbum}
      icon={<Tag size={50} />}
      photoset={tagAlbum ? tagAlbum.grouped_photos : []}
      idx2hash={tagAlbum ? tagAlbum.grouped_photos.flatMap(el => el.items) : []}
      // No photo filter for an album that is not there
      mediaType={notFound ? undefined : mediaType}
      emptyStateConfig={emptyStateConfig}
      selectable
    />
  );
}
