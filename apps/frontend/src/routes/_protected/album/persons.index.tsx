import { Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
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
import { PeopleHeader } from "../../../components/album/PeopleHeader";
import { PersonCard } from "../../../components/album/PersonCard";
import { PersonDeleteModal } from "../../../components/album/PersonDeleteModal";
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
    birth_date: null,
  });
  // The ⋮ button the dialogs were opened from. Their menu items are gone when they close,
  // so the Modal's own focus return dropped focus on the page body: it goes back here instead
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const { t } = useTranslation();
  const albumsQuery = useFetchPeopleAlbumsQuery();
  const { data: albums, isFetching } = albumsQuery;
  const listFailure = useListFailure(albumsQuery);
  const sizing = useAlbumListGridConfig({ shape: "portrait" });
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
      <PersonCard
        person={album}
        size={size}
        onMenuOpen={trigger => {
          menuTrigger.current = trigger;
        }}
        menuItems={
          <>
            <Menu.Item leftSection={<Edit size={14} />} onClick={() => openRenameDialog(album)}>
              {t("rename")}
            </Menu.Item>
            <Menu.Item leftSection={<UsersGroup size={14} />} onClick={() => openGroupsDialog(album)}>
              {t("persongroups.menu")}
            </Menu.Item>
            <Menu.Item leftSection={<Trash size={14} />} onClick={() => openDeleteDialog(album)}>
              {t("delete")}
            </Menu.Item>
          </>
        }
      />
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
        sort={personSort.menu}
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
