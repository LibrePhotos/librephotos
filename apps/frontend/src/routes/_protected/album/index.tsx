import { Box, Group, SimpleGrid, Skeleton, Stack, Text, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconAlbum,
  IconBookmark,
  IconChevronRight,
  IconFaceId,
  IconFolder,
  IconSettingsAutomation,
  IconTag,
  IconTags,
  IconUsers,
} from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useAllFolderSubfolders,
  useFetchAutoAlbumsQuery,
  useFetchPeopleAlbumsQuery,
  useFetchThingsAlbumsQuery,
  useFetchUserAlbumsQuery,
} from "../../../api_client/albums/hooks";
import { useFetchTagsQuery } from "../../../api_client/tags/hooks";
import { AlbumSection } from "../../../components/album/AlbumSection";
import classes from "../../../components/album/AlbumSection.module.css";
import { PlacesMapCard } from "../../../components/album/PlacesMapCard";
import { UserAlbumCard } from "../../../components/album/UserAlbumCard";
import { DeleteUserAlbumModal, RenameUserAlbumModal } from "../../../components/album/UserAlbumModals";
import { ModalAlbumShare } from "../../../components/sharing/ModalAlbumShare";

export const Route = createFileRoute("/_protected/album/")({
  component: AlbumExplore,
});

function AlbumExplore() {
  const { t } = useTranslation();

  // Album action state
  const [albumID, setAlbumID] = useState("");
  const [albumOwner, setAlbumOwner] = useState("");
  const [albumTitle, setAlbumTitle] = useState("");
  const [isDeleteDialogOpen, { open: showDeleteDialog, close: hideDeleteDialog }] = useDisclosure(false);
  const [isRenameDialogOpen, { open: showRenameDialog, close: hideRenameDialog }] = useDisclosure(false);
  const [isShareDialogOpen, { open: showShareDialog, close: hideShareDialog }] = useDisclosure(false);

  // Fetch all album types
  const { data: peopleAlbums, isLoading: isLoadingPeople } = useFetchPeopleAlbumsQuery();
  const { data: thingsAlbums, isLoading: isLoadingThings } = useFetchThingsAlbumsQuery();
  const { data: userAlbums, isLoading: isLoadingUser } = useFetchUserAlbumsQuery();
  // Every page of them, so the card counts all top-level folders, not the first 100
  const { subfolders: folders, isLoading: isLoadingFolders } = useAllFolderSubfolders();
  const { data: autoAlbums, isLoading: isLoadingAuto } = useFetchAutoAlbumsQuery();
  const { data: tags, isLoading: isLoadingTags } = useFetchTagsQuery();

  // Action handlers
  const openDeleteDialog = (id: string, title: string) => {
    showDeleteDialog();
    setAlbumID(id);
    setAlbumTitle(title);
  };

  const openRenameDialog = (id: string, title: string) => {
    showRenameDialog();
    setAlbumID(id);
    setAlbumTitle(title);
  };

  const openShareDialog = (id: string, title: string) => {
    showShareDialog();
    setAlbumID(id);
    setAlbumTitle(title);
    const album = userAlbums?.find(a => `${a.id}` === id);
    if (album) setAlbumOwner(album.owner.username);
  };

  // Transform albums to AlbumPreview format
  const peoplePreview = (peopleAlbums ?? []).map(album => ({
    id: album.id,
    title: album.name,
    photoCount: album.face_count,
    coverUrl: album.face_photo_url || undefined,
    faceUrl: album.face_url || undefined,
    isVideo: album.video,
    linkTo: `/album/persons/${album.id}`,
  }));

  const thingsPreview = (thingsAlbums ?? []).map(album => ({
    id: album.id,
    title: album.title,
    photoCount: album.photo_count,
    coverUrl: album.cover_photos[0]?.image_hash,
    isVideo: album.cover_photos[0]?.video,
    linkTo: `/album/things/${album.id}`,
  }));

  const foldersPreview = folders.map(folder => ({
    id: folder.path,
    title: folder.name,
    photoCount: folder.photo_count,
    coverUrl: undefined,
    linkTo: `/album/folder/${encodeURIComponent(folder.path)}`,
    icon: <IconFolder size={40} stroke={1.5} color="var(--mantine-color-gray-5)" />,
  }));

  const tagsPreview = (tags ?? []).map(tag => ({
    id: tag.id,
    title: tag.name,
    photoCount: tag.photo_count,
    coverUrl: tag.cover_photos[0]?.image_hash,
    isVideo: tag.cover_photos[0]?.video,
    linkTo: `/album/tags/${tag.id}`,
  }));

  const autoAlbumsPreview = (autoAlbums ?? []).map(album => ({
    id: album.id,
    title: album.title,
    photoCount: album.photo_count,
    coverUrl: album.photos?.image_hash,
    isVideo: album.photos?.video,
    linkTo: `/album/events/${album.id}`,
  }));

  return (
    <Box p={10}>
      {/* Same icon size and title/subtitle stack as the other album pages */}
      <Group gap="sm" wrap="nowrap" mb={10}>
        <IconAlbum size={50} />
        <Stack gap={0}>
          <Title order={2}>{t("explore.title")}</Title>
          <Text c="dimmed" size="sm">
            {t("explore.subtitle")}
          </Text>
        </Stack>
      </Group>

      <Stack gap="md">
        {/* My Albums - using UserAlbumCard component */}
        <div className={classes.section}>
          <div className={classes.header}>
            <Link to="/album/user" className={classes.headerLeft} style={{ textDecoration: "none", color: "inherit" }}>
              <IconBookmark size={24} stroke={1.5} />
              <div>
                <Title order={4}>{t("sidemenu.myalbums")}</Title>
                <Group gap={6}>
                  <Text size="sm" c="dimmed">
                    {t("explore.albumCount", { count: userAlbums?.length ?? 0 })}
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

          {isLoadingUser ? (
            <div className={classes.loadingContainer}>
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className={classes.skeleton}>
                  <Skeleton height={140} radius="md" />
                  <Skeleton height={16} mt={8} width="80%" />
                  <Skeleton height={12} mt={4} width="50%" />
                </div>
              ))}
            </div>
          ) : !userAlbums || userAlbums.length === 0 ? (
            <div className={classes.emptyState}>
              <Stack gap={4} align="center">
                <Text c="dimmed">{t("explore.noAlbums")}</Text>
                {/* How to make one: there is no "new album" button */}
                <Text c="dimmed" size="sm" ta="center">
                  {t("emptystate.useralbums.description")}
                </Text>
              </Stack>
            </div>
          ) : (
            <div className={classes.scrollContainer}>
              {userAlbums.slice(0, 12).map(album => (
                <UserAlbumCard
                  key={album.id}
                  album={album}
                  size={140}
                  showActions
                  onRename={openRenameDialog}
                  onShare={openShareDialog}
                  onDelete={openDeleteDialog}
                />
              ))}
            </div>
          )}
        </div>

        {/* People - avatar grid, full section */}
        <AlbumSection
          title={t("sidemenu.people")}
          icon={<IconUsers size={24} stroke={1.5} />}
          albums={peoplePreview}
          viewAllLink="/album/persons"
          isLoading={isLoadingPeople}
          count={peopleAlbums?.length}
          countLabel={t("explore.peopleCount", { count: peopleAlbums?.length ?? 0 })}
          emptyMessage={t("emptystate.people.title")}
          variant="avatarGrid"
          maxItems={16}
          actionLink="/faces"
          actionLabel={t("personalbum.managefaces")}
          actionIcon={<IconFaceId size={16} />}
          actionColor="orange"
        />

        {/* Category cards: five of them, so one row on large screens */}
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 5 }} spacing="md">
          <AlbumSection
            title={t("sidemenu.things")}
            icon={<IconTags size={20} stroke={1.5} />}
            albums={thingsPreview}
            viewAllLink="/album/things"
            isLoading={isLoadingThings}
            count={thingsAlbums?.length}
            countLabel={t("explore.thingCount", { count: thingsAlbums?.length ?? 0 })}
            variant="card"
          />
          <AlbumSection
            title={t("tags")}
            icon={<IconTag size={20} stroke={1.5} />}
            albums={tagsPreview}
            viewAllLink="/album/tags"
            isLoading={isLoadingTags}
            count={tags?.length}
            countLabel={t("explore.tagCount", { count: tags?.length ?? 0 })}
            variant="card"
          />
          <PlacesMapCard />
          <AlbumSection
            title={t("events")}
            icon={<IconSettingsAutomation size={20} stroke={1.5} />}
            albums={autoAlbumsPreview}
            viewAllLink="/album/events"
            isLoading={isLoadingAuto}
            count={autoAlbums?.length}
            countLabel={t("explore.eventCount", { count: autoAlbums?.length ?? 0 })}
            variant="card"
          />
          {/* Spans the row when two columns would leave it on its own */}
          <div className={classes.lastCategoryCard}>
            <AlbumSection
              title={t("folders")}
              icon={<IconFolder size={20} stroke={1.5} />}
              albums={foldersPreview}
              viewAllLink="/album/folder"
              isLoading={isLoadingFolders}
              count={folders.length}
              countLabel={t("explore.folderCount", { count: folders.length })}
              variant="card"
            />
          </div>
        </SimpleGrid>
      </Stack>

      <RenameUserAlbumModal
        opened={isRenameDialogOpen}
        onClose={hideRenameDialog}
        albumId={albumID}
        albumTitle={albumTitle}
        existingTitles={userAlbums?.map(album => album.title) ?? []}
      />

      {/* Share Modal */}
      <ModalAlbumShare
        isOpen={isShareDialogOpen}
        onRequestClose={hideShareDialog}
        albumID={albumID}
        ownerUsername={albumOwner}
      />

      <DeleteUserAlbumModal
        opened={isDeleteDialogOpen}
        onClose={hideDeleteDialog}
        albumId={albumID}
        albumTitle={albumTitle}
      />
    </Box>
  );
}
