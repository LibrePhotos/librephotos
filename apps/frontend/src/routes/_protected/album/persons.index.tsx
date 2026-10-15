import { ActionIcon, Menu, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconDotsVertical as DotsVertical,
  IconEdit as Edit,
  IconTrash as Trash,
  IconUsers as Users,
  IconUsersGroup as UsersGroup,
} from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  useDeletePersonAlbumMutation,
  useFetchPeopleAlbumsQuery,
  useRenamePersonAlbumMutation,
} from "../../../api_client/albums/hooks";
import type { Person, PersonList } from "../../../api_client/albums/hooks";
import { PEOPLE_SORT } from "../../../components/album/albumSortConfigs";
import { AlbumSortMenu } from "../../../components/album/AlbumSortMenu";
import { PeopleHeader } from "../../../components/album/PeopleHeader";
import { PersonDeleteModal } from "../../../components/album/PersonDeleteModal";
import { PersonFace } from "../../../components/album/PersonFace";
import personFaceClasses from "../../../components/album/PersonFace.module.css";
import { PersonGroupParam } from "../../../components/album/personGroupSearch";
import { PersonGroupsModal } from "../../../components/album/PersonGroupsModal";
import { PersonRenameModal } from "../../../components/album/PersonRenameModal";
import { useAlbumSort } from "../../../components/album/useAlbumSort";
import { usePeopleInGroup } from "../../../components/album/usePersonGroupFilter";
import { EmptyState } from "../../../components/common/EmptyState";
import { ErrorState } from "../../../components/common/ErrorState";
import { useListFailure } from "../../../components/common/useListFailure";
import { TileGrid } from "../../../components/virtual/TileGrid";
import { useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";

export const Route = createFileRoute("/_protected/album/persons/")({
  component: AlbumPeople,
  // The chosen group (#1126) stays in the URL, so Back from a person returns to it
  validateSearch: z.object({ group: PersonGroupParam }),
});

// One empty list while loading, so the sorted list is not recomputed on every render
const NO_PEOPLE: PersonList = [];

function AlbumPeople() {
  const navigate = Route.useNavigate();
  const [groupsDialogVisible, groupsDialog] = useDisclosure(false);
  const [deleteDialogVisible, { open: showDeleteDialog, close: hideDeleteDialog }] = useDisclosure(false);
  const [renameDialogVisible, { open: showRenameDialog, close: hideRenameDialog }] = useDisclosure(false);
  const [selectedAlbum, setSelectedAlbum] = useState<Person>({
    id: "",
    name: "",
    video: false,
    face_count: 0,
    face_photo_url: "",
    face_url: "",
    group_ids: [],
  });
  // The ⋮ button the dialogs were opened from. Their menu items are gone when they close,
  // so the Modal's own focus return dropped focus on the page body: it goes back here instead
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const { t } = useTranslation();
  const albumsQuery = useFetchPeopleAlbumsQuery();
  const { data: albums, isFetching } = albumsQuery;
  const listFailure = useListFailure(albumsQuery);
  const sizing = useAlbumListGridConfig();
  const renamePersonMutation = useRenamePersonAlbumMutation();
  const deletePersonMutation = useDeletePersonAlbumMutation();
  const hasAlbums = albums && albums.length > 0;
  // Sorted before the group filter, which keeps the order (#620)
  const personSort = useAlbumSort(PEOPLE_SORT, albums ?? NO_PEOPLE);
  const { groups, group, shown } = usePeopleInGroup(personSort.sorted, Route.useSearch().group);
  const showGroup = (next: number | undefined) => void navigate({ search: next === undefined ? {} : { group: next } });

  function openDeleteDialog(album: Person) {
    setSelectedAlbum(album);
    showDeleteDialog();
  }

  function openRenameDialog(album: Person) {
    setSelectedAlbum(album);
    showRenameDialog();
  }

  function openGroupsDialog(album: Person) {
    setSelectedAlbum(album);
    groupsDialog.open();
  }

  function closeGroupsDialog() {
    groupsDialog.close();
    menuTrigger.current?.focus();
  }

  function closeRenameDialog() {
    hideRenameDialog();
    menuTrigger.current?.focus();
  }

  function closeDeleteDialog() {
    hideDeleteDialog();
    menuTrigger.current?.focus();
  }

  function renderPerson(album: Person, size: number) {
    return (
      <>
        <PersonFace person={album} size={size} />
        <div className={personFaceClasses.menu}>
          {/* Its items open dialogs: handing focus back to the trigger took it from the
              dialog's input. Escape still returns it, and the dialogs do when they close. */}
          <Menu position="bottom-end" returnFocus={false}>
            <Menu.Target>
              {/* A solid chip: a bare icon vanished on light faces */}
              <ActionIcon
                variant="default"
                radius="xl"
                size="sm"
                aria-label={t("moreactions")}
                onClick={e => {
                  menuTrigger.current = e.currentTarget;
                }}
              >
                <DotsVertical size={16} />
              </ActionIcon>
            </Menu.Target>

            <Menu.Dropdown>
              <Menu.Item leftSection={<Edit size={14} />} onClick={() => openRenameDialog(album)}>
                {t("rename")}
              </Menu.Item>
              <Menu.Item leftSection={<UsersGroup size={14} />} onClick={() => openGroupsDialog(album)}>
                {t("persongroups.menu")}
              </Menu.Item>
              <Menu.Item leftSection={<Trash size={14} />} onClick={() => openDeleteDialog(album)}>
                {t("delete")}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </>
    );
  }

  function renderCaption(album: Person) {
    return (
      // Centred under the round face (#2241)
      <Stack gap={0} align="center" px={8} ta="center">
        <Text size="sm" fw={500} lineClamp={1} title={album.name}>
          {album.name}
        </Text>
        {/* face_count counts faces, not photos */}
        <Text size="xs">
          {t("facesdashboard.numberoffaces", { count: album.face_count, number: album.face_count })}
        </Text>
      </Stack>
    );
  }

  return (
    <>
      <PeopleHeader
        loading={isFetching}
        total={albums?.length ?? 0}
        shown={shown.length}
        groups={groups}
        group={group}
        onGroupChange={showGroup}
        sortMenu={<AlbumSortMenu {...personSort.menu} />}
      />
      {listFailure ? (
        <ErrorState failure={listFailure} />
      ) : !isFetching && !hasAlbums ? (
        <EmptyState
          icon={<Users size={40} />}
          title={t("emptystate.people.title")}
          description={t("emptystate.people.description")}
          actionLabel={t("emptystate.goToFaces")}
          actionLink="/faces"
        />
      ) : hasAlbums && shown.length === 0 ? (
        <EmptyState
          icon={<UsersGroup size={40} />}
          title={t("persongroups.emptytitle")}
          description={t("persongroups.emptydescription")}
          actionLabel={t("persongroups.all")}
          onAction={() => showGroup(undefined)}
        />
      ) : (
        <TileGrid
          scrollRestorationId="album-persons"
          items={shown}
          orderKey={personSort.orderKey}
          getKey={album => album.id}
          sizing={sizing}
          renderItem={renderPerson}
          renderCaption={renderCaption}
        />
      )}

      <PersonRenameModal
        opened={renameDialogVisible}
        onClose={closeRenameDialog}
        person={selectedAlbum}
        people={albums ?? []}
        onSubmit={newPersonName => {
          renamePersonMutation.mutate({
            id: selectedAlbum.id,
            personName: selectedAlbum.name,
            newPersonName,
          });
        }}
      />
      <PersonGroupsModal opened={groupsDialogVisible} onClose={closeGroupsDialog} person={selectedAlbum} />
      <PersonDeleteModal
        opened={deleteDialogVisible}
        onClose={closeDeleteDialog}
        person={selectedAlbum}
        onConfirm={() => {
          deletePersonMutation.mutate(selectedAlbum.id);
        }}
      />
    </>
  );
}
