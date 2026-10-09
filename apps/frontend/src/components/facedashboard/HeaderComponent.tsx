import { ActionIcon, Button, Chip, Divider, Group, Menu, Modal, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconChevronDown as ChevronDown,
  IconChevronRight as ChevronRight,
  IconDotsVertical as DotsVertical,
  IconEdit as Edit,
  IconTrash as Trash,
  IconUserCheck as UserCheck,
} from "@tabler/icons-react";
import { getRouteApi } from "@tanstack/react-router";
import { uniqBy } from "lodash-es";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useDeletePersonAlbumMutation,
  useFetchPeopleAlbumsQuery,
  useRenamePersonAlbumMutation,
} from "../../api_client/albums/hooks";
import { useSetFacesPersonLabelMutation } from "../../api_client/faces/hooks";
import type { CompletePersonFace } from "../../api_client/faces/types";
import classes from "./HeaderComponent.module.css";
import { isLoadedFace } from "./hooks/useVirtualizedGrid";
import type { FaceSelection } from "./hooks/useVirtualizedGrid";

type Props = {
  cell: CompletePersonFace;
  style: React.CSSProperties;
  setSelectedFaces: (faces: FaceSelection[]) => void;
  selectedFaces: readonly FaceSelection[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
};

const routeApi = getRouteApi("/_protected/faces");

export function HeaderComponent({
  cell,
  style,
  setSelectedFaces,
  selectedFaces,
  isCollapsed,
  onToggleCollapse,
}: Readonly<Props>) {
  const { tab: activeTab } = routeApi.useSearch();
  const { t } = useTranslation();
  const [checked, setChecked] = useState(false);
  const [renameDialogVisible, { open: showRenameDialog, close: hideRenameDialog }] = useDisclosure(false);
  const [deleteDialogVisible, { open: showDeleteDialog, close: hideDeleteDialog }] = useDisclosure(false);
  const { mutate: renamePerson } = useRenamePersonAlbumMutation();
  const { mutate: deletePerson } = useDeletePersonAlbumMutation();
  const { mutate: setFacesPersonLabel } = useSetFacesPersonLabelMutation();
  const { data: albums } = useFetchPeopleAlbumsQuery();
  const [personID, setPersonID] = useState("");
  const [personName, setPersonName] = useState("");
  const [newPersonName, setNewPersonName] = useState("");
  // The dialogs open from menu items that are gone when they close, so the Modal's own
  // focus return dropped focus on the page body: it goes back to the ⋮ button instead
  const menuTrigger = useRef<HTMLButtonElement>(null);

  function closeRenameDialog() {
    hideRenameDialog();
    menuTrigger.current?.focus();
  }

  function closeDeleteDialog() {
    hideDeleteDialog();
    menuTrigger.current?.focus();
  }

  function openDeleteDialog(id: string) {
    setPersonID(id);
    showDeleteDialog();
  }

  function openRenameDialog(id: string, name: string) {
    setPersonID(id);
    setPersonName(name);
    setNewPersonName("");
    showRenameDialog();
  }

  const trimmedName = newPersonName.trim();
  const nameTaken = !!albums?.some(el => el.name.toLowerCase().trim() === trimmedName.toLowerCase());

  // Faces that have not been paged in yet carry their index as id, so acting on them would hit
  // whatever real faces happen to have those ids
  const loadedFaces = cell.faces.filter(isLoadedFace);

  const handleClick = () => {
    if (!checked) {
      const facesToAdd = loadedFaces.map(i => ({ face_id: i.id, face_url: i.face_url }));
      const merged = uniqBy([...selectedFaces, ...facesToAdd], el => el.face_id);
      setSelectedFaces(merged);
    } else {
      const remainingFaces = selectedFaces.filter(i => loadedFaces.filter(j => j.id === i.face_id).length === 0);
      setSelectedFaces(remainingFaces);
    }
    setChecked(!checked);
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

  return (
    <Stack w="100%" justify="end" pb="xl" style={style}>
      <Group wrap="nowrap">
        <ActionIcon
          variant="subtle"
          color="gray"
          onClick={onToggleCollapse}
          aria-expanded={!isCollapsed}
          aria-label={
            isCollapsed
              ? t("facesdashboard.expandperson", { name: cell.name })
              : t("facesdashboard.collapseperson", { name: cell.name })
          }
        >
          {isCollapsed ? <ChevronRight /> : <ChevronDown />}
        </ActionIcon>
        <Chip
          variant="filled"
          radius="xs"
          size="lg"
          checked={checked}
          onChange={handleClick}
          classNames={{ root: classes.nameChip, label: classes.nameChipLabel, iconWrapper: classes.nameChipIcon }}
          wrapperProps={{ title: cell.name }}
        >
          {cell.name}
        </Chip>
        {activeTab === "inferred" && !(cell.kind === "CLUSTER" || cell.kind === "UNKNOWN") && (
          <Tooltip label={t("facesdashboard.explanationvalidate")}>
            <ActionIcon
              variant="light"
              color="green"
              aria-label={t("facesdashboard.explanationvalidate")}
              onClick={() => confirmFacesAssociation()}
            >
              <UserCheck />
            </ActionIcon>
          </Tooltip>
        )}
        {!(cell.kind === "CLUSTER" || cell.kind === "UNKNOWN") && (
          // Its items open dialogs: handing focus back to the trigger took it from the dialog's input
          <Menu position="bottom-end" returnFocus={false}>
            <Menu.Target>
              <ActionIcon ref={menuTrigger} variant="subtle" color="gray" aria-label={t("moreactions")}>
                <DotsVertical />
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
        <Text c="dimmed" style={{ flexShrink: 0 }}>
          {/* count picks the plural form; number keeps older translations of the key working */}
          {t("facesdashboard.numberoffaces", {
            count: cell.faces.length,
            number: cell.faces.length,
          })}
        </Text>
      </Group>

      <Divider />
      <Modal
        title={t("personalbum.renameperson")}
        onClose={closeRenameDialog}
        opened={renameDialogVisible}
        returnFocus={false}
      >
        {/* A form, so Enter renames too */}
        <form
          onSubmit={e => {
            e.preventDefault();
            // The backend rejects a blank name, and nothing would report that
            if (!trimmedName || nameTaken) return;
            renamePerson({ id: personID, personName, newPersonName: trimmedName });
            closeRenameDialog();
          }}
        >
          <Stack>
            <TextInput
              data-autofocus
              label={t("personalbum.nameplaceholder")}
              error={nameTaken ? t("personalbum.personalreadyexists", { name: trimmedName }) : false}
              onChange={e => {
                setNewPersonName(e.currentTarget.value);
              }}
              placeholder={personName}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={closeRenameDialog}>
                {t("cancel")}
              </Button>
              <Button disabled={!trimmedName || nameTaken} type="submit">
                {t("rename")}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
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
    </Stack>
  );
}
