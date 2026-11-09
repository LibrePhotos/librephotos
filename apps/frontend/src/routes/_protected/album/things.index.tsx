import type { ThingAlbumInfo } from "@librephotos/api-client";
import { IconTags as Tags } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFetchThingsAlbumsQuery } from "../../../api_client/albums/hooks";
import { THING_SORT } from "../../../components/album/albumSortConfigs";
import { AlbumSortMenu } from "../../../components/album/AlbumSortMenu";
import { cardTitle } from "../../../components/album/cardTitle";
import { useAlbumSort } from "../../../components/album/useAlbumSort";
import { CollectionCard } from "../../../components/common/CollectionCard";
import { EmptyState } from "../../../components/common/EmptyState";
import { ErrorState } from "../../../components/common/ErrorState";
import { useListFailure } from "../../../components/common/useListFailure";
import { PageHeader } from "../../../components/PageHeader";
import { TileGrid } from "../../../components/virtual/TileGrid";
import { useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";
import { useThingLabel } from "../../../hooks/useThingLabel";

export const Route = createFileRoute("/_protected/album/things/")({
  component: AlbumThing,
});

// One empty list while loading, so the sorted list is not recomputed on every render
const NO_THINGS: ThingAlbumInfo[] = [];

function AlbumThing() {
  const { t } = useTranslation();
  const albumsQuery = useFetchThingsAlbumsQuery();
  const { data: albums, isFetching } = albumsQuery;
  const listFailure = useListFailure(albumsQuery);
  const sizing = useAlbumListGridConfig();
  const hasAlbums = albums && albums.length > 0;
  const thingLabel = useThingLabel();
  // Named in the interface language (#2744) before sorting, so the order is the one on screen.
  // An album opens by its id; a hashtag album's "#word" is never a translated thing.
  const namedAlbums = useMemo(
    () => (albums ?? NO_THINGS).map(album => ({ ...album, title: thingLabel(album.title) })),
    [albums, thingLabel]
  );
  const albumSort = useAlbumSort(THING_SORT, namedAlbums);

  return (
    <div>
      <PageHeader
        title={t("things")}
        loading={isFetching}
        subtitle={t("thingalbum.showingthings", {
          count: albums?.length ?? 0,
          number: albums?.length ?? 0,
        })}
        actions={hasAlbums ? <AlbumSortMenu {...albumSort.menu} /> : null}
      />
      {listFailure ? (
        <ErrorState failure={listFailure} />
      ) : !isFetching && !hasAlbums ? (
        <EmptyState
          icon={<Tags size={40} />}
          title={t("emptystate.things.title")}
          description={t("emptystate.things.description")}
          actionLabel={t("emptystate.goToLibrary")}
          actionLink="/library"
        />
      ) : (
        <TileGrid
          scrollRestorationId="album-things"
          items={albumSort.sorted}
          orderKey={albumSort.orderKey}
          getKey={album => album.id}
          sizing={sizing}
          // A cover or a placeholder: an album whose covers are gone still opens (#2234)
          renderItem={(album, size) => (
            <CollectionCard
              size={size}
              title={cardTitle(album.title)}
              meta={t("numberofphotos", { count: album.photo_count, number: album.photo_count })}
              covers={album.cover_photos.slice(0, 1)}
              placeholder={<Tags />}
              renderLink={props => <Link {...props} to="/album/things/$id" params={{ id: String(album.id) }} />}
            />
          )}
        />
      )}
    </div>
  );
}
