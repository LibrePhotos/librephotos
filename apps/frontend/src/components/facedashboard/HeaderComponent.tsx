import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { IconEdit as Edit, IconTrash as Trash } from "@tabler/icons-react";
import _ from "lodash";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDisclosure } from "@mantine/hooks";
import { useAppSelector } from "../../store/store";
import { useRenamePersonAlbumMutation, useDeletePersonAlbumMutation } from "../../api_client/albums";
import { useFetchPeopleAlbumsQuery } from "../../api_client/albums";
import { useSetFacesPersonLabelMutation } from "../../api_client/faces";

type Props = Readonly<{
  cell: any;
  width: number;
  style: any;
  entrySquareSize: number;
  setSelectedFaces: (faces: any[]) => void;
  selectedFaces: any[];
}>;

export function HeaderComponent({
  cell,
  width,
  style,
  entrySquareSize,
  setSelectedFaces,
  selectedFaces,
}: Readonly<Props>) {
  const { t } = useTranslation();
  const [checked, setChecked] = useState(false);
  const [renameDialogVisible, { open: showRenameDialog, close: hideRenameDialog }] = useDisclosure(false);
  const [deleteDialogVisible, { open: showDeleteDialog, close: hideDeleteDialog }] = useDisclosure(false);
  const renamePerson = useRenamePersonAlbumMutation();
  const deletePerson = useDeletePersonAlbumMutation();
  const { data: albums } = useFetchPeopleAlbumsQuery();
  const setFacesPersonLabel = useSetFacesPersonLabelMutation();
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

  const handleClick = () => {
    if (!checked) {
      const facesToAdd = cell.faces.map(i => ({ face_id: i.id, face_url: i.face_url }));
      const merged = _.uniqBy([...selectedFaces, ...facesToAdd], el => el.face_id);
      setSelectedFaces(merged);
    } else {
      const remainingFaces = selectedFaces.filter(i => cell.faces.filter(j => j.id === i.face_id).length === 0);
      setSelectedFaces(remainingFaces);
    }
    setChecked(!checked);
  };

  const confirmFacesAssociation = () => {
    const facesToAddIDs = cell.faces.map(i => i.id);
    setFacesPersonLabel.mutate({ faceIds: facesToAddIDs, personName: cell.name });
  };

  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme();

  return (
    <div
      style={{
        ...style,
        width,
        height: entrySquareSize,
        backgroundColor: colorScheme === "dark" ? theme.colors.dark[7] : theme.colors.gray[2],
        textAlign: "center",
        cursor: "pointer",
        borderRadius: 10,
      }}
    >
      <Group
        style={{
          paddingLeft: 10,
          paddingRight: 10,
        }}
        justify="space-between"
      >
        <Group gap="xs">
          <Text size="sm" fw={500} mb={3}>
            {cell.name}
          </Text>
          <Text size="sm" c="dimmed" mb={3}>
            {cell.faces.length} {t("facesdashboard.faces")}
          </Text>
        </Group>
        <Group>
          <ActionIcon variant="light" color="blue" onClick={() => openRenameDialog(cell.id, cell.name)}>
            <Edit />
          </ActionIcon>
          <ActionIcon variant="light" color="red" onClick={() => openDeleteDialog(cell.id)}>
            <Trash />
          </ActionIcon>
        </Group>
      </Group>
      <Modal opened={renameDialogVisible} onClose={hideRenameDialog} title={<h3>{t("renameperson")}</h3>}>
        <Stack>
          <TextInput
            label={t("renameperson")}
            placeholder={personName}
            value={newPersonName}
            onChange={event => setNewPersonName(event.currentTarget.value)}
          />
          <Group justify="center">
            <Button
              color="blue"
              onClick={() => {
                hideRenameDialog();
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              color="blue"
              onClick={() => {
                renamePerson.mutate({ id: personID, personName: newPersonName, newPersonName: newPersonName });
                hideRenameDialog();
              }}
            >
              {t("confirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal opened={deleteDialogVisible} onClose={hideDeleteDialog} title={<h3>{t("deleteperson")}</h3>}>
        <Stack>
          {t("deletepersonexplanation")}
          <Group justify="center">
            <Button
              color="blue"
              onClick={() => {
                hideDeleteDialog();
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              color="red"
              onClick={() => {
                deletePerson.mutate(personID);
                hideDeleteDialog();
              }}
            >
              {t("confirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
