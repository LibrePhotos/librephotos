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
  const { inferredFacesList, labeledFacesList } = useAppSelector(store => store.faces);
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const { isOpen, onRequestClose, selectedFaces } = props;
  let filteredPeopleList = people;
  if (newPersonName.length > 0) {
    filteredPeopleList = people.filter(el => fuzzy_match(el.text.toLowerCase(), newPersonName.toLowerCase()));
  }

  const allFaces = _.concat(inferredFacesList, labeledFacesList);

  const selectedImageIDs = selectedFaces.map(faceID => {
    const res = allFaces.filter(face => face.id === faceID)[0].image;
    const splitBySlash = res.split("/");
    console.log(splitBySlash[splitBySlash.length - 1]);
    const faceImageID = splitBySlash[splitBySlash.length - 1];
    return faceImageID;
  });

  useEffect(() => {
    if (isOpen) {
      fetchPeople(dispatch);
    }
  }, [isOpen, dispatch]);

  return (
    <Modal
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
              <Avatar
                key={`selected_image${image}`}
                size={40}
                src={`${serverAddress}/media/faces/${image}`}
                radius="xl"
              />
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
              dispatch(setFacesPersonLabel(selectedFaces, newPersonName));
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
                      dispatch(setFacesPersonLabel(selectedFaces, item.text));
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
