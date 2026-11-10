import { Skeleton, Stack, Text } from "@mantine/core";
import { IconFolder, IconSettingsAutomation, IconTag, IconTags } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import React from "react";
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
import { HubPeopleRow } from "../../../components/album/HubPeopleRow";
import { PlacesMapCard } from "../../../components/album/PlacesMapCard";
import { UserAlbumCard } from "../../../components/album/UserAlbumCard";
import { DeleteUserAlbumModal, RenameUserAlbumModal } from "../../../components/album/UserAlbumModals";
import { useUserAlbumDialogs } from "../../../components/album/useUserAlbumDialogs";
import { ErrorState } from "../../../components/common/ErrorState";
import { useListFailure } from "../../../components/common/useListFailure";
import { PageBody } from "../../../components/PageBody";
import { PageHeader } from "../../../components/PageHeader";
import { ModalAlbumShare } from "../../../components/sharing/ModalAlbumShare";
import { useEventTitle } from "../../../hooks/useEventTitle";

/** How many albums the hub's row holds: one line of up to five on a wide screen; a phone swipes through all of them. */
const HUB_ROW_MAX = 12;

export const Route = createFileRoute("/_protected/album/")({
  component: AlbumExplore,
});

function AlbumExplore() {
  const { t } = useTranslation();
  const eventTitle = useEventTitle();

  const albumDialogs = useUserAlbumDialogs();

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

  // Transform albums to AlbumPreview format
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
      {/* 24px from the header block to the first section (its 12px and these), 40px between sections */}
      <PageBody gap={0} pt={12}>
        {/* One left edge for every section */}
        <Stack gap={40}>
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
              // (a phone scrolls the row sideways through more of them)
              <div className={clsx(classes.hubGrid, classes.hubRow)}>
                {userAlbums.slice(0, HUB_ROW_MAX).map(album => (
                  <UserAlbumCard
                    key={album.id}
                    album={album}
                    size={HUB_CARD_WIDTH}
                    showActions
                    onRename={albumDialogs.rename.open}
                    onShare={albumDialogs.share.open}
                    onDelete={albumDialogs.remove.open}
                  />
                ))}
              </div>
            )}
          </div>

          {/* People: the People page's portrait cards, in one row */}
          <HubPeopleRow people={peopleAlbums} isLoading={isLoadingPeople} error={peopleFailure} />

          {/* Category cards: five of them, so one row on large screens, in My Albums' grid */}
          <div className={classes.section}>
            <AlbumSectionHeading
              title={t("explore.collections")} // The five cards below
              summary={t("explore.collectionCount", { count: 5 })}
            />
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
          opened={albumDialogs.rename.opened}
          onClose={albumDialogs.rename.close}
          albumId={albumDialogs.album.id}
          albumTitle={albumDialogs.album.title}
          existingTitles={userAlbums?.map(album => album.title) ?? []}
        />

        {/* Share Modal */}
        <ModalAlbumShare
          isOpen={albumDialogs.share.opened}
          onRequestClose={albumDialogs.share.close}
          albumID={albumDialogs.album.id}
        />

        <DeleteUserAlbumModal
          opened={albumDialogs.remove.opened}
          onClose={albumDialogs.remove.close}
          albumId={albumDialogs.album.id}
          albumTitle={albumDialogs.album.title}
        />
      </PageBody>
    </>
  );
}
