import type { UserAlbumInfo } from "@librephotos/api-client";
import { Box, Menu, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconPhoto, IconShare, IconPolaroid as Polaroid } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedAlbumsByMeQuery } from "../../api_client/albums/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { albumColumnsFor } from "../../hooks/useAlbumListGridConfig";
import { ICON_SIZE } from "../../uiConstants";
import { CollectionCard } from "../common/CollectionCard";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { UserAvatar } from "../common/UserAvatar";
import { TileGrid } from "../virtual/TileGrid";
import type { TileGroup } from "../virtual/TileGrid";
import { useMeasuredTileSizing } from "../virtual/useMeasuredTileSizing";
import classes from "./AlbumsShared.module.css";
import { ModalAlbumShare } from "./ModalAlbumShare";
import { sharerName } from "./sharerGroups";

const DAY_HEADER_HEIGHT = 70;

export function AlbumsSharedByMe() {
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
  const albumsQuery = useFetchSharedAlbumsByMeQuery();
  const { data: albums, isFetching, isSuccess } = albumsQuery;
  const listFailure = useListFailure(albumsQuery);
  const { data: users } = useFetchUserListQuery();
  // Stop or change a share from here instead of opening each album.
  const [shareAlbumId, setShareAlbumId] = useState("");
  const [isShareDialogOpen, { open: openShareDialog, close: closeShareDialog }] = useDisclosure(false);

  // One group per user the albums are shared with, under a header with who it is
  const groups = useMemo((): TileGroup<UserAlbumInfo>[] => {
    if (!isSuccess) return [];
    return albums.map(group => {
      const owner = users?.filter(e => e.id === group.user_id)[0];
      const displayName = sharerName(owner, `${group.user_id}`);
      return {
        key: group.user_id,
        items: group.albums,
        header: (
          <Box h={`${DAY_HEADER_HEIGHT}px`} className={classes.ownerHeader}>
            <div className={classes.ownerRow}>
              <UserAvatar user={owner} size={36} />
              <div>
                <Text size="md" fw="bold">
                  {displayName}
                </Text>
                <Text size="xs" c="dimmed" className={classes.ownerLine}>
                  <Polaroid size={16} className={classes.polaroid} />
                  {t("sharing.youSharedAlbumsWithThem", { count: group.albums.length })}
                </Text>
              </div>
            </div>
          </Box>
        ),
      };
    });
  }, [albums, isSuccess, users, t]);

  return (
    <div ref={containerRef}>
      {/* Only before the first answer: a background refetch kept stacking a
          loader above the grid. */}
      {listFailure ? (
        <ErrorState failure={listFailure} />
      ) : (
        isFetching && !isSuccess && <PageLoader label={t("sharing.loadingAlbumsSharedByYou")} />
      )}

      {groups.length === 0 && isSuccess && (
        <Stack align="center" mt="xl">
          <Text c="dimmed">{t("sharing.noAlbumsSharedByYou")}</Text>
        </Stack>
      )}

      {groups.length > 0 && (
        <div>
          <TileGrid
            scrollRestorationId="sharing-albums-by-me"
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
                // Stop or change the share from here instead of opening the album
                menuLabel={`${t("useralbum.albumActions")}: ${album.title}`}
                menuItems={
                  <Menu.Item
                    leftSection={<IconShare size={ICON_SIZE.menu} />}
                    onClick={() => {
                      setShareAlbumId(`${album.id}`);
                      openShareDialog();
                    }}
                  >
                    {t("sidemenu.sharing")}
                  </Menu.Item>
                }
              />
            )}
          />
        </div>
      )}

      <ModalAlbumShare isOpen={isShareDialogOpen} onRequestClose={closeShareDialog} albumID={shareAlbumId} />
    </div>
  );
}
