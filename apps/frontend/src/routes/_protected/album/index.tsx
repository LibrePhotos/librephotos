import { Box, Button, Group, Modal, SimpleGrid, Skeleton, Stack, Text, TextInput, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconAlbum,
  IconBookmark,
  IconChevronRight,
  IconFaceId,
  IconFolder,
  IconTags,
  IconUsers,
  IconWand,
} from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useDeleteUserAlbumMutation,
  useFetchAutoAlbumsQuery,
  useFetchPeopleAlbumsQuery,
  useFetchThingsAlbumsQuery,
  useFetchUserAlbumsQuery,
  useRenameUserAlbumMutation,
} from "../../../api_client/albums/hooks";
import { useFetchFolderSubfoldersQuery } from "../../../api_client/albums/hooks/useFetchFolderAlbumsQuery";
import { AlbumSection } from "../../../components/album/AlbumSection";
import classes from "../../../components/album/AlbumSection.module.css";
import { PlacesMapCard } from "../../../components/album/PlacesMapCard";
import { UserAlbumCard } from "../../../components/album/UserAlbumCard";
import { ModalAlbumShare } from "../../../components/sharing/ModalAlbumShare";

export const Route = createFileRoute("/_protected/album/")();

export function AlbumExplore() {
  const { t } = useTranslation();

  // Album action state
  const [newAlbumTitle, setNewAlbumTitle] = useState("");
  const [albumID, setAlbumID] = useState("");
  const [albumOwner, setAlbumOwner] = useState("");
  const [albumTitle, setAlbumTitle] = useState("");
  const [isDeleteDialogOpen, { open: showDeleteDialog, close: hideDeleteDialog }] = useDisclosure(false);
  const [isRenameDialogOpen, { open: showRenameDialog, close: hideRenameDialog }] = useDisclosure(false);
  const [isShareDialogOpen, { open: showShareDialog, close: hideShareDialog }] = useDisclosure(false);

  // Mutations
  const deleteUserAlbum = useDeleteUserAlbumMutation();
  const renameUserAlbum = useRenameUserAlbumMutation();

  // Fetch all album types
  const { data: peopleAlbums, isLoading: isLoadingPeople } = useFetchPeopleAlbumsQuery();
  const { data: thingsAlbums, isLoading: isLoadingThings } = useFetchThingsAlbumsQuery();
  const { data: userAlbums, isLoading: isLoadingUser } = useFetchUserAlbumsQuery();
  const { data: folderData, isLoading: isLoadingFolders } = useFetchFolderSubfoldersQuery();
  const { data: autoAlbums, isLoading: isLoadingAuto } = useFetchAutoAlbumsQuery();

  const folders = folderData?.subfolders ?? [];

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
    setNewAlbumTitle("");
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
      <Group justify="left" mb="md">
        <IconAlbum size={40} stroke={1.5} />
        <div>
          <Title order={2}>{t("explore.title")}</Title>
          <Text c="dimmed">{t("explore.subtitle")}</Text>
        </div>
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
              <Text c="dimmed">{t("explore.noAlbums")}</Text>
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
          variant="avatarGrid"
          maxItems={16}
          actionLink="/faces"
          actionLabel={t("personalbum.managefaces")}
          actionIcon={<IconFaceId size={16} />}
          actionColor="orange"
        />

        {/* Category cards - 4 columns on large screens */}
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
          <AlbumSection
            title={t("sidemenu.things")}
            icon={<IconTags size={20} stroke={1.5} />}
            albums={thingsPreview}
            viewAllLink="/album/things"
            isLoading={isLoadingThings}
            count={thingsAlbums?.length}
            variant="card"
          />
          <PlacesMapCard />
          <AlbumSection
            title={t("sidemenu.autoalbums")}
            icon={<IconWand size={20} stroke={1.5} />}
            albums={autoAlbumsPreview}
            viewAllLink="/album/events"
            isLoading={isLoadingAuto}
            count={autoAlbums?.length}
            variant="card"
          />
          <AlbumSection
            title={t("folders")}
            icon={<IconFolder size={20} stroke={1.5} />}
            albums={foldersPreview}
            viewAllLink="/album/folder"
            isLoading={isLoadingFolders}
            count={folders.length}
            variant="card"
          />
        </SimpleGrid>
      </Stack>

      {/* Rename Modal */}
      <Modal size="sm" onClose={hideRenameDialog} opened={isRenameDialogOpen} title={t("useralbum.renamealbum")}>
        <Stack>
          <TextInput
            label={albumTitle}
            error={
              userAlbums?.map(el => el.title.toLowerCase().trim()).includes(newAlbumTitle.toLowerCase().trim())
                ? t("useralbum.albumalreadyexists", { name: newAlbumTitle.trim() })
                : ""
            }
            onChange={v => setNewAlbumTitle(v.currentTarget.value)}
            placeholder={t("useralbum.albumplaceholder")}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={hideRenameDialog}>
              {t("cancel")}
            </Button>
            <Button
              color="green"
              onClick={() => {
                renameUserAlbum.mutate({ id: albumID, title: albumTitle, newTitle: newAlbumTitle });
                hideRenameDialog();
              }}
              disabled={
                !newAlbumTitle.trim() ||
                userAlbums?.map(el => el.title.toLowerCase().trim()).includes(newAlbumTitle.toLowerCase().trim())
              }
            >
              {t("rename")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Share Modal */}
      <ModalAlbumShare
        isOpen={isShareDialogOpen}
        onRequestClose={hideShareDialog}
        albumID={albumID}
        ownerUsername={albumOwner}
      />

      {/* Delete Modal */}
      <Modal opened={isDeleteDialogOpen} onClose={hideDeleteDialog} title={t("delete")}>
        <Stack>
          <Text>{t("deletealbumexplanation")}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={hideDeleteDialog}>
              {t("cancel")}
            </Button>
            <Button
              color="red"
              onClick={() => {
                deleteUserAlbum.mutate({ id: albumID, albumTitle });
                hideDeleteDialog();
              }}
            >
              {t("confirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}

Route.update({ component: AlbumExplore });
