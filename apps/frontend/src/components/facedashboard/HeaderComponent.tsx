import {
  ActionIcon,
  Avatar,
  Button,
  Checkbox,
  Group,
  Menu,
  Modal,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconChevronDown as ChevronDown,
  IconDotsVertical as DotsVertical,
  IconEdit as Edit,
  IconPencil as Pencil,
  IconRestore as Restore,
  IconTrash as Trash,
  IconUserCheck as UserCheck,
} from "@tabler/icons-react";
import { getRouteApi } from "@tanstack/react-router";
import cx from "clsx";
import { uniqBy } from "lodash-es";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useDeletePersonAlbumMutation,
  useFetchPeopleAlbumsQuery,
  useRenamePersonAlbumMutation,
} from "../../api_client/albums/hooks";
import { useRestoreFacesMutation, useSetFacesPersonLabelMutation } from "../../api_client/faces/hooks";
import type { CompletePersonFace } from "../../api_client/faces/types";
import { PersonRenameModal } from "../album/PersonRenameModal";
import { canConfirmFace, canRestoreAll, hasPersonMenu, isNamedPerson } from "./faceActionRules";
import { isUnknownGroup } from "./facesTab";
import classes from "./HeaderComponent.module.css";
import { useFocusOnMount } from "./hooks/useFocusOnMount";
import { isLoadedFace, selectionOf } from "./hooks/useVirtualizedGrid";
import type { FaceSelection } from "./hooks/useVirtualizedGrid";

type Props = {
  cell: CompletePersonFace;
  style: React.CSSProperties;
  setSelectedFaces: (faces: FaceSelection[]) => void;
  selectedFaces: readonly FaceSelection[];
  /** Folds the person into a single cell of the grid of people (PersonCell). */
  onToggleCollapse: () => void;
  /** The face that stands for the person (#860); the avatar's placeholder while there is none. */
  coverUrl: string | undefined;
  /** The person was just unfolded: the toggle takes the focus their collapsed cell had. */
  takeFocus: boolean;
  onFocused: () => void;
  /** "Add a name" on a cluster: label all of its faces. Without it a cluster shows its own name. */
  onNameGroup?: (faces: FaceSelection[]) => void;
};

const routeApi = getRouteApi("/_protected/faces");

export function HeaderComponent({
  cell,
  style,
  setSelectedFaces,
  selectedFaces,
  onToggleCollapse,
  coverUrl,
  takeFocus,
  onFocused,
  onNameGroup,
}: Readonly<Props>) {
  const { tab: activeTab } = routeApi.useSearch();
  const { t } = useTranslation();
  const [checked, setChecked] = useState(false);
  const [renameDialogVisible, { open: showRenameDialog, close: hideRenameDialog }] = useDisclosure(false);
  const [deleteDialogVisible, { open: showDeleteDialog, close: hideDeleteDialog }] = useDisclosure(false);
  const { mutate: renamePerson } = useRenamePersonAlbumMutation();
  const { mutate: deletePerson } = useDeletePersonAlbumMutation();
  const { mutate: setFacesPersonLabel } = useSetFacesPersonLabelMutation();
  const { mutate: restoreFaces } = useRestoreFacesMutation();
  const { data: albums } = useFetchPeopleAlbumsQuery();
  const [personID, setPersonID] = useState("");
  const [personName, setPersonName] = useState("");
  // The dialogs open from menu items that are gone when they close, so the Modal's own
  // focus return dropped focus on the page body: it goes back to the ⋮ button instead
  const menuTrigger = useRef<HTMLButtonElement>(null);
  // The name opens the rename dialog too, and gets the focus back when it closes
  const nameButton = useRef<HTMLButtonElement>(null);
  const renameOpener = useRef<HTMLButtonElement | null>(null);
  const toggleRef = useFocusOnMount<HTMLButtonElement>(takeFocus, onFocused);

  function closeRenameDialog() {
    hideRenameDialog();
    (renameOpener.current ?? menuTrigger.current)?.focus();
  }

  function closeDeleteDialog() {
    hideDeleteDialog();
    menuTrigger.current?.focus();
  }

  function openDeleteDialog(id: string) {
    setPersonID(id);
    showDeleteDialog();
  }

  function openRenameDialog(id: string, name: string, opener: HTMLButtonElement | null = menuTrigger.current) {
    renameOpener.current = opener;
    setPersonID(id);
    setPersonName(name);
    showRenameDialog();
  }

  // Faces that have not been paged in yet carry their index as id, so acting on them would hit
  // whatever real faces happen to have those ids
  const loadedFaces = cell.faces.filter(isLoadedFace);

  const handleClick = () => {
    if (!checked) {
      const facesToAdd = loadedFaces.map(selectionOf);
      const merged = uniqBy([...selectedFaces, ...facesToAdd], el => el.face_id);
      setSelectedFaces(merged);
    } else {
      const remainingFaces = selectedFaces.filter(i => loadedFaces.filter(j => j.id === i.face_id).length === 0);
      setSelectedFaces(remainingFaces);
    }
    setChecked(!checked);
  };

  // The Deleted tab (#127): the person's faces leave the tab, so they leave the selection too
  const restoreAll = () => {
    const faceIds = loadedFaces.map(face => face.id);
    restoreFaces({ faceIds });
    setSelectedFaces(selectedFaces.filter(selected => !faceIds.includes(selected.face_id)));
  };

  const confirmFacesAssociation = () => {
    const facesToAddIDs = loadedFaces.map(i => i.id);
    setFacesPersonLabel({ faceIds: facesToAddIDs, personName: cell.name });
  };

  useEffect(() => {
    // deselect when no faces of the current group are selected
    const selectedFacesOfGroup = selectedFaces.filter(
      i => cell.faces.filter(j => !j.isTemp && j.id === i.face_id).length > 0
    );
    if (selectedFacesOfGroup.length === 0) {
      setChecked(false);
    }
  }, [cell.faces, selectedFaces]);

  const faceCount = t("facesdashboard.facescounter", { count: cell.faces.length });
  // The grid places the header as its row's one cell, a face wide: the header spans the row
  const rowStyle: React.CSSProperties = { ...style, width: "100%" };
  // A cluster nobody has named (not "Unknown - Other", where rejected faces go) offers a name
  const unnamed = !isNamedPerson(cell) && !isUnknownGroup(cell) && activeTab !== "deleted" && !!onNameGroup;

  function nameElement() {
    if (hasPersonMenu(activeTab, cell)) {
      return (
        <UnstyledButton
          ref={nameButton}
          className={classes.nameButton}
          aria-label={t("facesdashboard.renameperson", { name: cell.name })}
          title={cell.name}
          onClick={() => openRenameDialog(String(cell.id), cell.name, nameButton.current)}
        >
          <span className={classes.nameText}>{cell.name}</span>
          <Pencil size={14} className={classes.pencil} aria-hidden />
        </UnstyledButton>
      );
    }
    if (unnamed) {
      return (
        <UnstyledButton
          className={cx(classes.nameButton, classes.placeholder)}
          aria-label={t("facesdashboard.addnamefor", { name: cell.name })}
          title={cell.name}
          onClick={() => onNameGroup?.(loadedFaces.map(selectionOf))}
        >
          <span className={classes.nameText}>{t("facesdashboard.addname")}</span>
          <Pencil size={14} className={classes.pencil} aria-hidden />
        </UnstyledButton>
      );
    }
    return (
      <Text component="span" className={classes.nameText} title={cell.name}>
        {cell.name}
      </Text>
    );
  }

  return (
    <div className={classes.row} style={rowStyle}>
      <ActionIcon
        ref={toggleRef}
        variant="subtle"
        color="gray"
        size="sm"
        onClick={onToggleCollapse}
        aria-expanded
        aria-label={t("facesdashboard.collapseperson", { name: cell.name })}
      >
        <ChevronDown size={16} />
      </ActionIcon>
      {/* The name says who it is, so the face is decoration */}
      <Avatar src={coverUrl} alt="" radius="xl" size={32} className={classes.cover} />
      {/* The name over its count, so a card's narrow header keeps room for the name */}
      <div className={classes.titles}>
        {nameElement()}
        {/* count picks the plural form */}
        <span className={classes.count}>{faceCount}</span>
      </div>
      <Checkbox
        size="xs"
        className={classes.groupCheck}
        data-shown={checked || selectedFaces.length > 0 || undefined}
        checked={checked}
        onChange={handleClick}
        aria-label={t("facesdashboard.selectgroup", { name: cell.name })}
      />
      {canConfirmFace(activeTab, cell) && (
        <Tooltip label={t("facesdashboard.explanationvalidate")}>
          <ActionIcon
            variant="subtle"
            color="green"
            size="sm"
            aria-label={t("facesdashboard.explanationvalidate")}
            onClick={() => confirmFacesAssociation()}
          >
            <UserCheck size={16} />
          </ActionIcon>
        </Tooltip>
      )}
      {canRestoreAll(activeTab, cell) && (
        <Tooltip label={t("facesdashboard.restoreall", { name: cell.name })}>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={t("facesdashboard.restoreall", { name: cell.name })}
            onClick={restoreAll}
          >
            <Restore size={16} />
          </ActionIcon>
        </Tooltip>
      )}
      {hasPersonMenu(activeTab, cell) && (
        // Its items open dialogs: handing focus back to the trigger took it from the dialog's input
        <Menu position="bottom-end" returnFocus={false}>
          <Menu.Target>
            <ActionIcon ref={menuTrigger} variant="subtle" color="gray" size="sm" aria-label={t("moreactions")}>
              <DotsVertical size={16} />
            </ActionIcon>
          </Menu.Target>

          <Menu.Dropdown>
            <Menu.Item leftSection={<Edit size={14} />} onClick={() => openRenameDialog(String(cell.id), cell.name)}>
              {t("rename")}
            </Menu.Item>
            <Menu.Item leftSection={<Trash size={14} />} onClick={() => openDeleteDialog(String(cell.id))}>
              {t("delete")}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      )}
      <PersonRenameModal
        opened={renameDialogVisible}
        onClose={closeRenameDialog}
        // The people list has the avatar and the count the merge offer names
        person={
          albums?.find(album => album.id === personID) ?? {
            id: personID,
            name: personName,
            face_url: "",
            face_count: 0,
          }
        }
        people={albums ?? []}
        onSubmit={newPersonName => renamePerson({ id: personID, personName, newPersonName })}
      />
      <Modal
        opened={deleteDialogVisible}
        title={t("personalbum.deleteperson")}
        onClose={closeDeleteDialog}
        returnFocus={false}
      >
        <Stack>
          <Text size="sm">{t("personalbum.deletepersondescription")}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={closeDeleteDialog}>
              {t("cancel")}
            </Button>
            <Button
              color="red"
              onClick={() => {
                deletePerson(personID);
                closeDeleteDialog();
              }}
            >
              {t("delete")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
