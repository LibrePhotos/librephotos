import type { UserAlbumInfo } from "@librephotos/api-client";
import { Avatar, Box, Menu, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconDoorExit, IconPhoto, IconPolaroid as Polaroid } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedAlbumsWithMeQuery } from "../../api_client/albums/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { albumColumnsFor } from "../../hooks/useAlbumListGridConfig";
import { ICON_SIZE } from "../../uiConstants";
import { LeaveSharedAlbumModal, type LeavableAlbum } from "../album/LeaveSharedAlbumModal";
import { CollectionCard } from "../common/CollectionCard";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { TileGrid } from "../virtual/TileGrid";
import type { TileGroup } from "../virtual/TileGrid";
import { useMeasuredTileSizing } from "../virtual/useMeasuredTileSizing";
import classes from "./AlbumsShared.module.css";
import { avatarSrc } from "./avatarSrc";
import { sharerName } from "./sharerGroups";

const DAY_HEADER_HEIGHT = 70;

export function AlbumsSharedWithMe() {
  const { t } = useTranslation();
  // Sized from the width the grid actually gets, less room for its scrollbar, so the columns fit
  // it and follow a resize.
  const { ref: containerRef, sizing } = useMeasuredTileSizing({
    // The album lists' columns and gaps; the title sits on the cover
    columnsFor: albumColumnsFor,
    cellPadding: 8,
    captionHeight: 0,
    reservedHeight: 45 + 60 + 40,
  });
  const albumsQuery = useFetchSharedAlbumsWithMeQuery();
  const { data: albumsSharedToMe, isFetching, isSuccess } = albumsQuery;
  const listFailure = useListFailure(albumsQuery);
  const { data: users } = useFetchUserListQuery();
  // The album the "Leave album" dialog asks about; kept after closing so the dialog can animate out.
  const [leaving, setLeaving] = useState<LeavableAlbum>();
  const [leaveOpened, leaveDialog] = useDisclosure(false);

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
            scrollRestorationId="sharing-albums-with-me"
            groups={groups}
            headerHeight={DAY_HEADER_HEIGHT}
            getKey={album => album.id}
            sizing={sizing}
            renderItem={(album, size) => (
              <CollectionCard
                size={size}
                title={album.title}
                meta={t("numberofphotos", { count: album.photo_count, number: album.photo_count })}
                covers={album.cover_photo ? [album.cover_photo] : []}
                placeholder={<IconPhoto />}
                renderLink={props => <Link {...props} to="/album/user/$id" params={{ id: String(album.id) }} />}
                // The one thing a recipient can do (#2210): leave the album, which asks first
                menuLabel={`${t("useralbum.albumActions")}: ${album.title}`}
                menuItems={
                  <Menu.Item
                    color="red"
                    leftSection={<IconDoorExit size={ICON_SIZE.menu} />}
                    onClick={() => {
                      setLeaving(album);
                      leaveDialog.open();
                    }}
                  >
                    {t("useralbum.leavealbum")}
                  </Menu.Item>
                }
              />
            )}
          />
        </div>
      )}
      {leaving && <LeaveSharedAlbumModal opened={leaveOpened} onClose={leaveDialog.close} album={leaving} />}
    </div>
  );
}
