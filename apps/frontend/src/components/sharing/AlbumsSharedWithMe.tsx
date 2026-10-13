import type { UserAlbumInfo } from "@librephotos/api-client";
import { Anchor, Avatar, Box, Stack, Text } from "@mantine/core";
import { IconPolaroid as Polaroid } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import cx from "clsx";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedAlbumsWithMeQuery } from "../../api_client/albums/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { calculateGridCellSize } from "../../util/gridUtils";
import gridClasses from "../album/AlbumGridCell.module.css";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { Tile } from "../Tile";
import { TileGrid } from "../virtual/TileGrid";
import type { TileGroup } from "../virtual/TileGrid";
import { useMeasuredTileSizing } from "../virtual/useMeasuredTileSizing";
import classes from "./AlbumsShared.module.css";
import { avatarSrc } from "./avatarSrc";
import { sharerName } from "./sharerGroups";

const DAY_HEADER_HEIGHT = 70;
// Below the cover: a one-line title (md, 24.8px) and the photo count (sm, 20.3px).
const CAPTION_HEIGHT = 52;

const columnsFor = (width: number) => calculateGridCellSize(width).numEntrySquaresPerRow;

export function AlbumsSharedWithMe() {
  const { t } = useTranslation();
  // Sized from the width the grid actually gets, less room for its scrollbar, so the columns fit
  // it and follow a resize.
  const { ref: containerRef, sizing } = useMeasuredTileSizing({
    columnsFor,
    cellPadding: 1,
    captionHeight: CAPTION_HEIGHT,
    reservedHeight: 45 + 60 + 40,
  });
  const albumsQuery = useFetchSharedAlbumsWithMeQuery();
  const { data: albumsSharedToMe, isFetching, isSuccess } = albumsQuery;
  const listFailure = useListFailure(albumsQuery);
  const { data: users } = useFetchUserListQuery();

  // One group per user who shares albums with you, under a header with who it is
  const groups = useMemo((): TileGroup<UserAlbumInfo>[] => {
    if (!isSuccess) return [];
    return albumsSharedToMe.map(group => {
      const owner = users?.filter(e => e.id === group.user_id)[0];
      const displayName = sharerName(owner, `user(${group.user_id})`);
      return {
        key: group.user_id,
        items: group.albums,
        header: (
          <Box h={`${DAY_HEADER_HEIGHT}px`} className={classes.ownerHeader}>
            <div className={classes.ownerRow}>
              <Avatar size={36} radius="xl" src={avatarSrc(owner)} />
              <div>
                <Text size="md" fw="bold">
                  {displayName}
                </Text>
                <Text size="xs" c="dimmed" className={classes.ownerLine}>
                  <Polaroid size={16} className={classes.polaroid} />
                  {t("sharing.sharedAlbumsWithYou", { count: group.albums.length })}
                </Text>
              </div>
            </div>
          </Box>
        ),
      };
    });
  }, [albumsSharedToMe, isSuccess, users, t]);

  return (
    <div ref={containerRef}>
      {listFailure ? (
        <ErrorState failure={listFailure} />
      ) : (
        isFetching && !isSuccess && <PageLoader label={t("sharing.loadingAlbumsSharedWithYou")} />
      )}

      {groups.length === 0 && isSuccess && (
        <Stack align="center" mt="xl">
          <Text c="dimmed">{t("sharing.noAlbumsSharedWithYou")}</Text>
        </Stack>
      )}

      {groups.length > 0 && (
        <div>
          <TileGrid
            groups={groups}
            headerHeight={DAY_HEADER_HEIGHT}
            getKey={album => album.id}
            sizing={sizing}
            renderItem={(album, size) => (
              <>
                <Anchor
                  renderRoot={rootProps => (
                    <Link {...rootProps} to="/album/user/$id" params={{ id: String(album.id) }} />
                  )}
                >
                  {album.cover_photo ? (
                    <Tile
                      className={cx(gridClasses.cover, classes.coverTile)}
                      width={size}
                      height={size}
                      image_hash={album.cover_photo.image_hash}
                      video={album.cover_photo.video}
                    />
                  ) : (
                    <div className={cx(gridClasses.cover, classes.emptyCover)} style={{ width: size, height: size }} />
                  )}
                </Anchor>
                <Text fw={700} mt={4} lineClamp={1} title={album.title}>
                  {album.title}
                </Text>
                <Text size="sm" c="dimmed">
                  {t("numberofphotos", { count: album.photo_count, number: album.photo_count })}
                </Text>
              </>
            )}
          />
        </div>
      )}
    </div>
  );
}
