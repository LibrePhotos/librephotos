import { Avatar, Button, Divider, Group, Modal, ScrollArea, Stack, Text, TextInput, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import _ from "lodash";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { setFacesPersonLabel } from "../../actions/facesActions";
import { fetchPeople } from "../../actions/peopleActions";
import { serverAddress } from "../../api_client/apiClient";
import { useAppDispatch, useAppSelector } from "../../store/store";

function fuzzy_match(str, pattern) {
  if (pattern.split("").length > 0) {
    pattern = pattern
      .split("")
      .map(a => _.escapeRegExp(a))
      .reduce((a, b) => `${a}.*${b}`);
    return new RegExp(pattern).test(str);
  }
  return false;
}

type Props = {
  isOpen: boolean;
  onRequestClose: () => void;
  selectedFaces: any[];
};

export const ModalPersonEdit = (props: Props) => {
  const [newPersonName, setNewPersonName] = useState("");

  const matches = useMediaQuery("(min-width: 700px)");
  const { people } = useAppSelector(store => store.people);

  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const { isOpen, onRequestClose, selectedFaces } = props;
  let filteredPeopleList = people;

  if (newPersonName.length > 0) {
    filteredPeopleList = people.filter(el => fuzzy_match(el.text.toLowerCase(), newPersonName.toLowerCase()));
  }

  const selectedImageIDs = selectedFaces.map(face => face.face_url);
  const selectedFaceIDs = selectedFaces.map(face => face.face_id);

  useEffect(() => {
    if (isOpen) {
      fetchPeople(dispatch);
    }
  }, [isOpen, dispatch]);

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
        <Text color="dimmed">
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
              people.map(el => el.text.toLowerCase().trim()).includes(newPersonName.toLowerCase().trim())
                ? t("personalbum.personalreadyexists", {
                    name: newPersonName.trim(),
                  })
                : ""
            }
            onChange={v => {
              setNewPersonName(v.currentTarget.value);
            }}
            placeholder={t("personedit.personname")}
          />
          <Button
            onClick={() => {
              dispatch(setFacesPersonLabel(selectedFaceIDs, newPersonName));
              onRequestClose();
              setNewPersonName("");
            }}
            disabled={people.map(el => el.text.toLowerCase().trim()).includes(newPersonName.toLowerCase().trim())}
            type="submit"
          >
            {t("personedit.addperson")}
          </Button>
        </Group>
        <Divider />
        <Stack style={{ height: matches ? "50vh" : "25vh", overflowY: "scroll" }}>
          {filteredPeopleList.length > 0 &&
            filteredPeopleList.map(item => (
              <Group key={item.id}>
                <Avatar radius="xl" size={60} src={serverAddress + item.face_url} />
                <div>
                  <Title
                    order={4}
                    onClick={() => {
                      dispatch(setFacesPersonLabel(selectedFaceIDs, item.text));
                      onRequestClose();
                    }}
                  >
                    {item.text}
                  </Title>
                  <Text size="sm" color="dimmed">
                    {t("numberofphotos", {
                      number: item.face_count,
                    })}
                  </Text>
                </div>
              </Group>
            ))}
        </Stack>
      </Stack>
    </Modal>
  );
};
