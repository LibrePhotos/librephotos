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
import _ from "lodash";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useDeletePersonAlbumMutation,
  useFetchPeopleAlbumsQuery,
  useRenamePersonAlbumMutation,
} from "../../api_client/albums/hooks";
import { useSetFacesPersonLabelMutation } from "../../api_client/faces/hooks";

type Props = {
  cell: any;
  style: any;
  setSelectedFaces: any;
  selectedFaces: any;
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

  // Faces that have not been paged in yet carry their index as id, so acting on them would hit
  // whatever real faces happen to have those ids
  const loadedFaces = cell.faces.filter(face => !face.isTemp);

  const handleClick = () => {
    if (!checked) {
      const facesToAdd = loadedFaces.map(i => ({ face_id: i.id, face_url: i.face_url }));
      const merged = _.uniqBy([...selectedFaces, ...facesToAdd], el => el.face_id);
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
      <Group>
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
        <Chip variant="filled" radius="xs" size="lg" checked={checked} onChange={handleClick}>
          {cell.name}
        </Chip>
        {activeTab === "inferred" && !(cell.kind === "CLUSTER" || cell.kind === "UNKNOWN") && (
          <Tooltip label={t("facesdashboard.explanationvalidate")}>
            <ActionIcon variant="light" color="green" disabled={false} onClick={() => confirmFacesAssociation()}>
              <UserCheck />
            </ActionIcon>
          </Tooltip>
        )}
        {!(cell.kind === "CLUSTER" || cell.kind === "UNKNOWN") && (
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray">
                <DotsVertical />
              </ActionIcon>
            </Menu.Target>

            <Menu.Dropdown>
              <Menu.Item leftSection={<Edit />} onClick={() => openRenameDialog(cell.id, cell.name)}>
                {t("rename")}
              </Menu.Item>
              <Menu.Item leftSection={<Trash />} onClick={() => openDeleteDialog(cell.id)}>
                {t("delete")}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
        <Text c="dimmed">
          {t("facesdashboard.numberoffaces", {
            number: cell.faces.length,
          })}
        </Text>
      </Group>

      <Divider />
      <Modal title={t("personalbum.renameperson")} onClose={hideRenameDialog} opened={renameDialogVisible}>
        <Group>
          <TextInput
            error={
              albums?.map(el => el.name.toLowerCase().trim()).includes(newPersonName.toLowerCase().trim())
                ? t("personalbum.personalreadyexists", {
                    name: newPersonName.trim(),
                  })
                : false
            }
            onChange={e => {
              setNewPersonName(e.currentTarget.value);
            }}
            placeholder={t("personalbum.nameplaceholder")}
          />
          <Button
            onClick={() => {
              renamePerson({ id: personID, personName, newPersonName });
              hideRenameDialog();
            }}
            disabled={albums?.map(el => el.name.toLowerCase().trim()).includes(newPersonName.toLowerCase().trim())}
            type="submit"
          >
            {t("rename")}
          </Button>
        </Group>
      </Modal>
      <Modal opened={deleteDialogVisible} title={t("personalbum.deleteperson")} onClose={hideDeleteDialog}>
        <Text size="sm">{t("personalbum.deletepersondescription")}</Text>
        <Group>
          <Button onClick={hideDeleteDialog}>{t("cancel")}</Button>
          <Button
            color="red"
            onClick={() => {
              deletePerson(personID);
              hideDeleteDialog();
            }}
          >
            {t("delete")}
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
