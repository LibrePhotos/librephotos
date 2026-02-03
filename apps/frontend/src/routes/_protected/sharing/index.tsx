import { Avatar, Box, Group, Skeleton, Stack, Text, Title, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconChevronRight, IconDownload, IconLink, IconUpload, IconUsers, IconWorld } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useFetchDateAlbumsQuery,
  useFetchSharedAlbumsByMeQuery,
  useFetchSharedAlbumsWithMeQuery,
  useFetchUserAlbumsQuery,
} from "../../../api_client/albums/hooks";
import { useFetchSharedPhotosByMeQuery, useFetchSharedPhotosWithMeQuery } from "../../../api_client/photos/hooks";
import { Photoset } from "../../../api_client/photos/types";
import { useFetchUserListQuery } from "../../../api_client/user/hooks";
import classes from "../../../components/album/AlbumSection.module.css";
import { ModalAlbumShare } from "../../../components/sharing/ModalAlbumShare";
import { Tile } from "../../../components/Tile";
import { getPhotosFlatFromGroupedByDate } from "../../../util/util";

export const Route = createFileRoute("/_protected/sharing/")();

function publicUsers(items: any[] = []) {
  return items.filter(el => el.public_sharing);
}

export function SharingExplore() {
  const { t } = useTranslation();
  const [albumID, setAlbumID] = useState("");
  const [albumOwner, setAlbumOwner] = useState("");
  const [isShareDialogOpen, { open: showShareDialog, close: hideShareDialog }] = useDisclosure(false);

  const openShareDialog = (id: string, ownerUsername: string) => {
    setAlbumID(id);
    setAlbumOwner(ownerUsername);
    showShareDialog();
  };

  // Fetch all sharing data
  const { data: users, isLoading: isLoadingUsers } = useFetchUserListQuery();
  const { data: photosWithMe = [], isLoading: isLoadingPhotosWithMe } = useFetchSharedPhotosWithMeQuery();
  const { data: albumsWithMe = [], isLoading: isLoadingAlbumsWithMe } = useFetchSharedAlbumsWithMeQuery();
  const { data: photosByMe = [], isLoading: isLoadingPhotosByMe } = useFetchSharedPhotosByMeQuery();
  const { data: albumsByMe = [], isLoading: isLoadingAlbumsByMe } = useFetchSharedAlbumsByMeQuery();

  // Fetch public links data (albums with public=true and public photos)
  const { data: userAlbums = [], isLoading: isLoadingUserAlbums } = useFetchUserAlbumsQuery();
  const { data: publicPhotosGrouped, isLoading: isLoadingPublicPhotos } = useFetchDateAlbumsQuery({
    photosetType: Photoset.PUBLIC,
  });

  const publicUsersList = publicUsers(users);

  // Filter albums that are public (shared via link)
  const publicLinkAlbums = useMemo(() => userAlbums.filter(album => album.public), [userAlbums]);

  // Flatten public photos from grouped data
  const publicPhotos = useMemo(
    () => (publicPhotosGrouped ? getPhotosFlatFromGroupedByDate(publicPhotosGrouped) : []),
    [publicPhotosGrouped]
  );

  // Count totals
  const totalPhotosWithMe = photosWithMe.reduce((acc, group) => acc + group.photos.length, 0);
  const totalAlbumsWithMe = albumsWithMe.reduce((acc, group) => acc + group.albums.length, 0);
  const totalPhotosByMe = photosByMe.reduce((acc, group) => acc + group.photos.length, 0);
  const totalAlbumsByMe = albumsByMe.reduce((acc, group) => acc + group.albums.length, 0);

  // Get preview photos for shared with me
  const previewPhotosWithMe = photosWithMe.flatMap(group => group.photos).slice(0, 6);
  const previewAlbumsWithMe = albumsWithMe.flatMap(group => group.albums).slice(0, 6);

  // Get preview photos for shared by me
  const previewPhotosByMe = photosByMe.flatMap(group => group.photos).slice(0, 6);
  const previewAlbumsByMe = albumsByMe.flatMap(group => group.albums).slice(0, 6);

  // Get preview for public links
  const previewPublicPhotos = publicPhotos.filter(p => !p.isTemp).slice(0, 6);
  const previewPublicAlbums = publicLinkAlbums.slice(0, 6);

  return (
    <Box p={10}>
      <Group justify="left" mb="md">
        <IconUsers size={40} stroke={1.5} />
        <div>
          <Title order={2}>{t("sidemenu.sharing")}</Title>
          <Text c="dimmed">{t("sharing.subtitle", "Photos and albums shared with others")}</Text>
        </div>
      </Group>

      <Stack gap="md">
        {/* Public Users Section */}
        <div className={classes.section}>
          <div className={classes.header}>
            <Link
              to="/sharing/public"
              className={classes.headerLeft}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <IconWorld size={24} stroke={1.5} />
              <div>
                <Title order={4}>{t("sidemenu.publicphotos")}</Title>
                <Group gap={6}>
                  <Text size="sm" c="dimmed">
                    {t("sharing.userCount", { count: publicUsersList.length })}
                  </Text>
                  <Text size="sm" c="dimmed">
                    ·
                  </Text>
                  <Text size="sm" c="blue">
                    {t("explore.viewAll")}
                  </Text>
                  <IconChevronRight size={14} color="var(--mantine-color-blue-6)" />
                </Group>
              </div>
            </Link>
          </div>

          {isLoadingUsers ? (
            <div className={classes.avatarGridLoading}>
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 70 }}>
                  <Skeleton height={56} width={56} circle />
                  <Skeleton height={10} width={50} mt={4} />
                </div>
              ))}
            </div>
          ) : publicUsersList.length === 0 ? (
            <div className={classes.emptyState}>
              <Text c="dimmed">{t("sharing.noPublicUsers", "No users with public photos")}</Text>
            </div>
          ) : (
            <div className={classes.avatarGrid}>
              {publicUsersList.slice(0, 14).map(user => {
                const displayName =
                  user.first_name && user.last_name ? `${user.first_name} ${user.last_name}` : user.username;
                return (
                  <Link key={user.id} to={`/user/${user.username}/`} className={classes.avatarItem}>
                    <div className={classes.avatar}>
                      <Avatar size={52} radius="xl" src="/unknown_user.jpg">
                        {displayName.charAt(0).toUpperCase()}
                      </Avatar>
                    </div>
                    <Text className={classes.avatarName} title={displayName}>
                      {displayName}
                    </Text>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Shared With You Section */}
        <div className={classes.section}>
          <div className={classes.header}>
            <Link
              to="/sharing/withme/photos"
              className={classes.headerLeft}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <IconDownload size={24} stroke={1.5} color="var(--mantine-color-green-6)" />
              <div>
                <Title order={4}>{t("sidemenu.sharedwithyou")}</Title>
                <Group gap={6}>
                  <Text size="sm" c="dimmed">
                    {t("sharing.itemCount", {
                      photos: totalPhotosWithMe,
                      albums: totalAlbumsWithMe,
                    })}
                  </Text>
                  <Text size="sm" c="dimmed">
                    ·
                  </Text>
                  <Text size="sm" c="blue">
                    {t("explore.viewAll")}
                  </Text>
                  <IconChevronRight size={14} color="var(--mantine-color-blue-6)" />
                </Group>
              </div>
            </Link>
          </div>

          {isLoadingPhotosWithMe && isLoadingAlbumsWithMe ? (
            <div className={classes.loadingContainer}>
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className={classes.skeleton}>
                  <Skeleton height={140} radius="md" />
                  <Skeleton height={16} mt={8} width="80%" />
                  <Skeleton height={12} mt={4} width="50%" />
                </div>
              ))}
            </div>
          ) : totalPhotosWithMe === 0 && totalAlbumsWithMe === 0 ? (
            <div className={classes.emptyState}>
              <Text c="dimmed">{t("sharing.nothingSharedWithYou", "No one has shared anything with you yet")}</Text>
            </div>
          ) : (
            <div className={classes.scrollContainer}>
              {/* Show preview photos */}
              {previewPhotosWithMe.map(photo => (
                <Link key={photo.id} to="/sharing/withme/photos" className={classes.albumCard}>
                  <div className={classes.albumCover}>
                    <Tile
                      video={photo.type === "video"}
                      width={140}
                      height={140}
                      image_hash={photo.id}
                      className={classes.albumCoverImage}
                    />
                  </div>
                </Link>
              ))}
              {/* Show preview albums */}
              {previewAlbumsWithMe.map(album => (
                <Link key={album.id} to={`/album/user/${album.id}`} className={classes.albumCard}>
                  <div className={classes.albumCover}>
                    {album.cover_photo ? (
                      <Tile
                        video={album.cover_photo.video ?? false}
                        width={140}
                        height={140}
                        image_hash={album.cover_photo.image_hash}
                        className={classes.albumCoverImage}
                      />
                    ) : (
                      <Text c="dimmed" size="xs">
                        {t("explore.noCover")}
                      </Text>
                    )}
                  </div>
                  <div className={classes.albumInfo}>
                    <Text size="sm" fw={500} lineClamp={1} title={album.title}>
                      {album.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t("numberofphotos", { number: album.photo_count })}
                    </Text>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* You Shared Section */}
        <div className={classes.section}>
          <div className={classes.header}>
            <Link
              to="/sharing/byme/photos"
              className={classes.headerLeft}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <IconUpload size={24} stroke={1.5} color="var(--mantine-color-red-6)" />
              <div>
                <Title order={4}>{t("sidemenu.youshared")}</Title>
                <Group gap={6}>
                  <Text size="sm" c="dimmed">
                    {t("sharing.itemCount", {
                      photos: totalPhotosByMe,
                      albums: totalAlbumsByMe,
                    })}
                  </Text>
                  <Text size="sm" c="dimmed">
                    ·
                  </Text>
                  <Text size="sm" c="blue">
                    {t("explore.viewAll")}
                  </Text>
                  <IconChevronRight size={14} color="var(--mantine-color-blue-6)" />
                </Group>
              </div>
            </Link>
          </div>

          {isLoadingPhotosByMe && isLoadingAlbumsByMe ? (
            <div className={classes.loadingContainer}>
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className={classes.skeleton}>
                  <Skeleton height={140} radius="md" />
                  <Skeleton height={16} mt={8} width="80%" />
                  <Skeleton height={12} mt={4} width="50%" />
                </div>
              ))}
            </div>
          ) : totalPhotosByMe === 0 && totalAlbumsByMe === 0 ? (
            <div className={classes.emptyState}>
              <Text c="dimmed">{t("sharing.nothingSharedByYou", "You haven't shared anything yet")}</Text>
            </div>
          ) : (
            <div className={classes.scrollContainer}>
              {/* Show preview photos */}
              {previewPhotosByMe.map(photo => (
                <Link key={photo.id} to="/sharing/byme/photos" className={classes.albumCard}>
                  <div className={classes.albumCover}>
                    <Tile
                      video={photo.type === "video"}
                      width={140}
                      height={140}
                      image_hash={photo.id}
                      className={classes.albumCoverImage}
                    />
                  </div>
                </Link>
              ))}
              {/* Show preview albums */}
              {previewAlbumsByMe.map(album => (
                <Link key={album.id} to={`/album/user/${album.id}`} className={classes.albumCard}>
                  <div className={classes.albumCover}>
                    {album.cover_photo ? (
                      <Tile
                        video={album.cover_photo.video ?? false}
                        width={140}
                        height={140}
                        image_hash={album.cover_photo.image_hash}
                        className={classes.albumCoverImage}
                      />
                    ) : (
                      <Text c="dimmed" size="xs">
                        {t("explore.noCover")}
                      </Text>
                    )}
                  </div>
                  <div className={classes.albumInfo}>
                    <Text size="sm" fw={500} lineClamp={1} title={album.title}>
                      {album.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t("numberofphotos", { number: album.photo_count })}
                    </Text>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Public Links Section */}
        <div className={classes.section}>
          <div className={classes.header}>
            <Link
              to="/sharing/links"
              className={classes.headerLeft}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <IconLink size={24} stroke={1.5} color="var(--mantine-color-violet-6)" />
              <div>
                <Title order={4}>{t("sharing.publicLinks", "Public Links")}</Title>
                <Group gap={6}>
                  <Text size="sm" c="dimmed">
                    {t("sharing.itemCount", {
                      photos: publicPhotos.filter(p => !p.isTemp).length,
                      albums: publicLinkAlbums.length,
                    })}
                  </Text>
                  <Text size="sm" c="dimmed">
                    ·
                  </Text>
                  <Text size="sm" c="blue">
                    {t("explore.viewAll")}
                  </Text>
                  <IconChevronRight size={14} color="var(--mantine-color-blue-6)" />
                </Group>
              </div>
            </Link>
          </div>

          {isLoadingUserAlbums && isLoadingPublicPhotos ? (
            <div className={classes.loadingContainer}>
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className={classes.skeleton}>
                  <Skeleton height={140} radius="md" />
                  <Skeleton height={16} mt={8} width="80%" />
                  <Skeleton height={12} mt={4} width="50%" />
                </div>
              ))}
            </div>
          ) : publicPhotos.filter(p => !p.isTemp).length === 0 && publicLinkAlbums.length === 0 ? (
            <div className={classes.emptyState}>
              <Text c="dimmed">{t("sharing.noPublicLinks", "You haven't made anything public via link yet")}</Text>
            </div>
          ) : (
            <div className={classes.scrollContainer}>
              {/* Show preview public albums */}
              {previewPublicAlbums.map(album => (
                <div key={album.id} style={{ position: "relative" }}>
                  <Link to={`/album/user/${album.id}`} className={classes.albumCard}>
                    <div className={classes.albumCover}>
                      {album.cover_photo ? (
                        <Tile
                          video={album.cover_photo.video ?? false}
                          width={140}
                          height={140}
                          image_hash={album.cover_photo.image_hash}
                          className={classes.albumCoverImage}
                        />
                      ) : (
                        <Text c="dimmed" size="xs">
                          {t("explore.noCover")}
                        </Text>
                      )}
                    </div>
                    <div className={classes.albumInfo}>
                      <Text size="sm" fw={500} lineClamp={1} title={album.title}>
                        {album.title}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {t("numberofphotos", { number: album.photo_count })}
                      </Text>
                    </div>
                  </Link>
                  <Tooltip label={t("sidemenu.sharing")}>
                    <div
                      role="button"
                      tabIndex={0}
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        zIndex: 1,
                        backgroundColor: "rgba(0, 0, 0, 0.5)",
                        borderRadius: 4,
                        padding: "4px 6px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      onClick={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        openShareDialog(`${album.id}`, album.owner.username);
                      }}
                      onKeyDown={e => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openShareDialog(`${album.id}`, album.owner.username);
                        }
                      }}
                    >
                      <IconLink size={16} color="white" />
                    </div>
                  </Tooltip>
                </div>
              ))}
              {/* Show preview public photos */}
              {previewPublicPhotos.map(photo => (
                <Link key={photo.id} to="/sharing/links" className={classes.albumCard}>
                  <div className={classes.albumCover}>
                    <Tile
                      video={photo.type === "video"}
                      width={140}
                      height={140}
                      image_hash={photo.id}
                      className={classes.albumCoverImage}
                    />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </Stack>

      <ModalAlbumShare
        isOpen={isShareDialogOpen}
        onRequestClose={hideShareDialog}
        albumID={albumID}
        ownerUsername={albumOwner}
      />
    </Box>
  );
}

Route.update({ component: SharingExplore });
