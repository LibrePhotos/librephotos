import { Skeleton, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconFaceId, IconFolder, IconSettingsAutomation, IconTag, IconTags } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
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
import { AlbumSection, AlbumSectionHeading, HUB_CARD_WIDTH } from "../../../components/album/AlbumSection";
import classes from "../../../components/album/AlbumSection.module.css";
import { PlacesMapCard } from "../../../components/album/PlacesMapCard";
import { UserAlbumCard } from "../../../components/album/UserAlbumCard";
import { DeleteUserAlbumModal, RenameUserAlbumModal } from "../../../components/album/UserAlbumModals";
import { ErrorState } from "../../../components/common/ErrorState";
import { useListFailure } from "../../../components/common/useListFailure";
import { PageBody } from "../../../components/PageBody";
import { PageHeader } from "../../../components/PageHeader";
import { ModalAlbumShare } from "../../../components/sharing/ModalAlbumShare";
import { useEventTitle } from "../../../hooks/useEventTitle";

export const Route = createFileRoute("/_protected/album/")({
  component: AlbumExplore,
});

function AlbumExplore() {
  const { t } = useTranslation();
  const eventTitle = useEventTitle();

  // Album action state
  const [albumID, setAlbumID] = useState("");
  const [albumOwner, setAlbumOwner] = useState("");
  const [albumTitle, setAlbumTitle] = useState("");
  const [isDeleteDialogOpen, { open: showDeleteDialog, close: hideDeleteDialog }] = useDisclosure(false);
  const [isRenameDialogOpen, { open: showRenameDialog, close: hideRenameDialog }] = useDisclosure(false);
  const [isShareDialogOpen, { open: showShareDialog, close: hideShareDialog }] = useDisclosure(false);

  // Fetch all album types
  const peopleQuery = useFetchPeopleAlbumsQuery();
  const { data: peopleAlbums, isLoading: isLoadingPeople } = peopleQuery;
  const peopleFailure = useListFailure(peopleQuery);
  const { data: thingsAlbums, isLoading: isLoadingThings } = useFetchThingsAlbumsQuery();
  const userAlbumsQuery = useFetchUserAlbumsQuery();
  const { data: userAlbums, isLoading: isLoadingUser } = userAlbumsQuery;
  const userAlbumsFailure = useListFailure(userAlbumsQuery);
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

  // Each folder's newest photo, so the Folders card is a collage like the others
  const foldersPreview = folders.map(folder => ({
    id: folder.path,
    title: folder.name,
    photoCount: folder.photo_count,
    coverUrl: folder.cover_photo?.image_hash,
    isVideo: folder.cover_photo?.video,
    linkTo: `/album/folder/${encodeURIComponent(folder.path)}`,
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
    title: eventTitle(album),
    photoCount: album.photo_count,
    coverUrl: album.photos?.image_hash,
    isVideo: album.photos?.video,
    linkTo: `/album/events/${album.id}`,
  }));

  return (
    <>
      <PageHeader title={t("explore.title")} />
      <PageBody gap={0}>
        {/* One left edge for every section, 24px between them */}
        <Stack gap={24}>
          {/* My Albums - using UserAlbumCard component */}
          <div className={classes.section}>
            <AlbumSectionHeading
              title={t("sidemenu.myalbums")}
              summary={t("explore.albumCount", { count: userAlbums?.length ?? 0 })}
              viewAllLink="/album/user"
            />

            {isLoadingUser ? (
              <div className={clsx(classes.hubGrid, classes.hubRow)}>
                {[1, 2, 3, 4, 5].map(i => (
                  <Skeleton key={i} className={classes.hubSkeleton} radius={12} />
                ))}
              </div>
            ) : userAlbumsFailure ? (
              <ErrorState failure={userAlbumsFailure} compact />
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
              // The same grid as the Collections under it, first line only: one card width on the hub
              <div className={clsx(classes.hubGrid, classes.hubRow)}>
                {userAlbums.slice(0, 5).map(album => (
                  <UserAlbumCard
                    key={album.id}
                    album={album}
                    size={HUB_CARD_WIDTH}
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
            albums={peoplePreview}
            viewAllLink="/album/persons"
            isLoading={isLoadingPeople}
            error={peopleFailure}
            count={peopleAlbums?.length}
            countLabel={t("explore.peopleCount", { count: peopleAlbums?.length ?? 0 })}
            emptyMessage={t("emptystate.people.title")}
            variant="avatarGrid"
            maxItems={16}
            actionLink="/faces"
            actionLabel={t("personalbum.managefaces")}
            actionIcon={<IconFaceId size={16} />}
          />

          {/* Category cards: five of them, so one row on large screens, in My Albums' grid */}
          <div className={classes.section}>
            <AlbumSectionHeading title={t("explore.collections")} />
            <div className={classes.hubGrid}>
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
          </div>
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
      </PageBody>
    </>
  );
}
