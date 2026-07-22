import {
  Avatar,
  Button,
  Divider,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPeopleAlbumsQuery } from "../../api_client/albums/hooks";
import type { Person } from "../../api_client/albums/hooks/useFetchPeopleAlbumsQuery";
import { serverAddress } from "../../api_client/apiClient";
import { useSetFacesPersonLabelMutation } from "../../api_client/faces";
import { useRecentlyTaggedPeople } from "../../hooks/useRecentlyTaggedPeople";
import { fuzzyMatch } from "../../util/util";

type Props = Readonly<{
  isOpen: boolean;
  onRequestClose: () => void;
  resetGroups?: () => void;
  selectedFaces: any[];
}>;

type PersonRowProps = Readonly<{
  person: Person;
  onSelect: (person: Person) => void;
}>;

function PersonRow({ person, onSelect }: PersonRowProps) {
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme();
  const { t } = useTranslation();

  return (
    <UnstyledButton
      style={{
        display: "block",
        borderRadius: theme.radius.xl,
        backgroundColor: colorScheme === "dark" ? theme.colors.dark[6] : theme.colors.gray[0],
      }}
      onClick={() => onSelect(person)}
    >
      <Group>
        <Avatar radius="xl" size={60} src={serverAddress + person.face_url} />
        <div>
          <Title
            style={{ width: "250px", textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden" }}
            order={4}
          >
            {person.name}
          </Title>
          <Text size="sm" c="dimmed">
            {t("numberofphotos", {
              number: person.face_count,
            })}
          </Text>
        </div>
      </Group>
    </UnstyledButton>
  );
}

export function ModalPersonEdit({ isOpen, onRequestClose, selectedFaces, resetGroups = () => {} }: Props) {
  const [newPersonName, setNewPersonName] = useState("");
  const matches = useMediaQuery("(min-width: 700px)");
  const { data: people } = useFetchPeopleAlbumsQuery();
  const { mutate: setFacesPersonLabel } = useSetFacesPersonLabelMutation();
  const recentlyTaggedPeople = useRecentlyTaggedPeople(people);

  const { t } = useTranslation();

  let filteredPeopleList = people;

  if (newPersonName.length > 0) {
    filteredPeopleList = people?.filter(el => fuzzyMatch(newPersonName, el.name));
  }

  // Once the user is searching, a fixed shortcut list is only noise.
  const showRecentlyTagged = newPersonName.length === 0 && recentlyTaggedPeople.length > 0;

  const selectedImageIDs = selectedFaces.map(face => face.face_url);
  const selectedFaceIDs = selectedFaces.map(face => face.face_id);

  function personExist(name: string) {
    return people?.map(person => person.name.toLowerCase().trim()).includes(name.toLowerCase().trim());
  }

  function labelSelectedFacesAs(person: Person) {
    setFacesPersonLabel({ faceIds: selectedFaceIDs, personName: person.name });
    onRequestClose();
    setNewPersonName("");
  }

  return (
    <Modal
      zIndex={1500}
      opened={isOpen}
      title={<Title>{t("personedit.labelfaces")}</Title>}
      onClose={() => {
        onRequestClose();
        setNewPersonName("");
      }}
    >
      <Stack>
        <Text c="dimmed">
          {t("personedit.numberselected", {
            number: selectedFaces.length,
          })}
        </Text>
        <ScrollArea style={{ height: 50 }}>
          <Group>
            {selectedImageIDs.map(image => (
              <Avatar key={`selected_image${image}`} size={40} src={`${serverAddress}${image}`} radius="xl" />
            ))}
          </Group>
        </ScrollArea>

        <Divider />
        <Title order={5}>{t("personedit.newperson")}</Title>
        <Group>
          <TextInput
            error={
              personExist(newPersonName) ? t("personalbum.personalreadyexists", { name: newPersonName.trim() }) : ""
            }
            value={newPersonName}
            onChange={v => {
              setNewPersonName(v.currentTarget.value);
            }}
            placeholder={t("personedit.personname")}
          />
          <Button
            onClick={() => {
              setFacesPersonLabel({ faceIds: selectedFaceIDs, personName: newPersonName });
              if (resetGroups) {
                resetGroups();
              }
              onRequestClose();
              setNewPersonName("");
            }}
            disabled={personExist(newPersonName) || newPersonName.trim().length === 0}
            type="submit"
          >
            {t("personedit.addperson")}
          </Button>
        </Group>
        <Divider />
        <Stack
          style={{
            height: matches ? "50vh" : "25vh",
            overflowY: "scroll",
          }}
        >
          {showRecentlyTagged && (
            <>
              <Title order={5}>{t("personedit.recentlytagged")}</Title>
              <Stack>
                {recentlyTaggedPeople.map(item => (
                  <PersonRow key={item.id} person={item} onSelect={labelSelectedFacesAs} />
                ))}
              </Stack>
              <Divider />
            </>
          )}
          {filteredPeopleList &&
            filteredPeopleList.length > 0 &&
            filteredPeopleList?.map(item => <PersonRow key={item.id} person={item} onSelect={labelSelectedFacesAs} />)}
        </Stack>
      </Stack>
    </Modal>
  );
}
