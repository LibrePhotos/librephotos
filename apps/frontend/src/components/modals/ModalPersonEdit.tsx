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
import { schemaResolver, useForm } from "@mantine/form";
import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPeopleAlbumsQuery } from "../../api_client/albums/hooks";
import type { Person } from "../../api_client/albums/hooks/useFetchPeopleAlbumsQuery";
import { useSetFacesPersonLabelMutation } from "../../api_client/faces";
import { serverAddress } from "../../api_client/urls";
import { useIsDesktopLayout } from "../../hooks/useIsDesktopLayout";
import { useRecentlyTaggedPeople } from "../../hooks/useRecentlyTaggedPeople";
import { fuzzyMatch } from "../../util/util";
import { makePersonNameSchema } from "../album/personName.schema";
import { modalTitleStyles } from "./modalTitleStyles";
import { RecentlyTaggedGrid } from "./RecentlyTaggedGrid";

/** A face the dialog labels: its id, and its crop for the preview row. */
type FaceToLabel = Readonly<{ face_id: number; face_url: string }>;

type Props = Readonly<{
  isOpen: boolean;
  onRequestClose: () => void;
  resetGroups?: () => void;
  selectedFaces: readonly FaceToLabel[];
  /**
   * Takes over what picking a person does. The dialog is also used for a face
   * that does not exist yet -- a box the user just drew -- where there is no
   * face id to label and the caller creates the face instead.
   */
  onPersonChosen?: (personName: string) => void;
  /** Replaces the "n selected" line when the dialog is not acting on a selection. */
  prompt?: string;
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
            {/* face_count counts faces, not photos; number keeps the plain key working in locales without plurals */}
            {t("facesdashboard.numberoffaces", { count: person.face_count, number: person.face_count })}
          </Text>
        </div>
      </Group>
    </UnstyledButton>
  );
}

export function ModalPersonEdit({
  isOpen,
  onRequestClose,
  selectedFaces,
  resetGroups = () => {},
  onPersonChosen,
  prompt,
}: Props) {
  const matches = useIsDesktopLayout();
  const { data: people } = useFetchPeopleAlbumsQuery();
  const { mutate: setFacesPersonLabel } = useSetFacesPersonLabelMutation();
  const recentlyTaggedPeople = useRecentlyTaggedPeople(people);
  const recentlyTaggedHeading = useId();

  const { t } = useTranslation();
  // The new person's name, which also filters the list of people below it.
  const form = useForm({
    initialValues: { name: "" },
    validate: schemaResolver(
      makePersonNameSchema(
        t,
        (people ?? []).map(person => person.name)
      ),
      { sync: true }
    ),
    validateInputOnChange: ["name"],
    transformValues: ({ name }) => ({ name: name.trim() }),
  });
  const newPersonName = form.values.name;

  let filteredPeopleList = people;

  if (newPersonName.length > 0) {
    filteredPeopleList = people?.filter(el => fuzzyMatch(newPersonName, el.name));
  }

  // Once the user is searching, a fixed shortcut list is only noise.
  const showRecentlyTagged = newPersonName.length === 0 && recentlyTaggedPeople.length > 0;

  const selectedImageIDs = selectedFaces.map(face => face.face_url);
  const selectedFaceIDs = selectedFaces.map(face => face.face_id);

  function applyPersonName(personName: string) {
    if (onPersonChosen) {
      onPersonChosen(personName);
    } else {
      setFacesPersonLabel({ faceIds: selectedFaceIDs, personName });
    }
    onRequestClose();
    form.reset();
  }

  function labelSelectedFacesAs(person: Person) {
    applyPersonName(person.name);
  }

  return (
    <Modal
      styles={modalTitleStyles}
      zIndex={1500}
      opened={isOpen}
      title={t("personedit.labelfaces")}
      onClose={() => {
        onRequestClose();
        form.reset();
      }}
    >
      <Stack>
        <Text c="dimmed">
          {prompt ??
            t("personedit.numberselected", {
              number: selectedFaces.length,
            })}
        </Text>
        {selectedImageIDs.length > 0 && (
          <ScrollArea style={{ height: 50 }}>
            <Group>
              {selectedImageIDs.map(image => (
                <Avatar key={`selected_image${image}`} size={40} src={`${serverAddress}${image}`} radius="xl" />
              ))}
            </Group>
          </ScrollArea>
        )}

        <Divider />
        <Title order={5}>{t("personedit.newperson")}</Title>
        <Group>
          <TextInput placeholder={t("personedit.personname")} {...form.getInputProps("name")} />
          {/* No <form>, as before: the field also filters the list, so Enter does not create a person */}
          <Button
            onClick={() =>
              form.onSubmit(({ name }) => {
                applyPersonName(name);
                resetGroups();
              })()
            }
            disabled={!form.isValid()}
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
              <Title order={5} id={recentlyTaggedHeading}>
                {t("personedit.recentlytagged")}
              </Title>
              <RecentlyTaggedGrid
                people={recentlyTaggedPeople}
                onSelect={labelSelectedFacesAs}
                labelledBy={recentlyTaggedHeading}
              />
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
