import { Flex, Group, Text } from "@mantine/core";
import { IconTags as Tags } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchThingsAlbumsQuery } from "../../../api_client/albums/hooks";
import gridClasses from "../../../components/album/AlbumGridCell.module.css";
import { EmptyState } from "../../../components/common/EmptyState";
import { ErrorState } from "../../../components/common/ErrorState";
import { useListFailure } from "../../../components/common/useListFailure";
import { PageHeader } from "../../../components/PageHeader";
import { Tile } from "../../../components/Tile";
import { TileGrid } from "../../../components/virtual/TileGrid";
import { useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";

export const Route = createFileRoute("/_protected/album/things/")({
  component: AlbumThing,
});

function AlbumThing() {
  const { t } = useTranslation();
  const albumsQuery = useFetchThingsAlbumsQuery();
  const { data: albums, isFetching } = albumsQuery;
  const listFailure = useListFailure(albumsQuery);
  const sizing = useAlbumListGridConfig();
  const hasAlbums = albums && albums.length > 0;

  return (
    <div>
      <PageHeader
        icon={Tags}
        title={t("things")}
        loading={isFetching}
        subtitle={t("thingalbum.showingthings", {
          count: albums?.length ?? 0,
          number: albums?.length ?? 0,
        })}
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
          items={albums ?? []}
          getKey={album => album.id}
          sizing={sizing}
          renderItem={(album, size) =>
            album.cover_photos.slice(0, 1).map(photo => (
              <Link key={album.id} to="/album/things/$id" params={{ id: album.id.toString() }}>
                <Tile
                  className={gridClasses.cover}
                  video={photo.video === true}
                  height={size}
                  width={size}
                  image_hash={photo.image_hash}
                />
              </Link>
            ))
          }
          renderCaption={album => (
            <Group justify="space-between">
              <Flex gap={0} justify="flex-start" direction="column" px={8}>
                <Text size="sm" fw={500} lineClamp={1} title={album.title}>
                  {album.title}
                </Text>
                <Text size="xs">{t("numberofphotos", { count: album.photo_count, number: album.photo_count })}</Text>
              </Flex>
            </Group>
          )}
        />
      )}
    </div>
  );
}
