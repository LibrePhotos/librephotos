import { Avatar, Button, Divider, Group, Modal, ScrollArea, Stack, Text, TextInput, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { showNotification } from "@mantine/notifications";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchPeople } from "../../actions/peopleActions";
import { api } from "../../api_client/api";
import { serverAddress } from "../../api_client/apiClient";
import i18n from "../../i18n";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { fuzzyMatch } from "../../util/util";

type Props = {
  isOpen: boolean;
  onRequestClose: () => void;
  selectedFaces: any[];
};

export function ModalPersonEdit(props: Props) {
  const [newPersonName, setNewPersonName] = useState("");

  const matches = useMediaQuery("(min-width: 700px)");
  const { people } = useAppSelector(store => store.people);

  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const { isOpen, onRequestClose, selectedFaces } = props;
  let filteredPeopleList = people;

  if (newPersonName.length > 0) {
    filteredPeopleList = people.filter(el => fuzzyMatch(newPersonName, el.text));
  }

  const selectedImageIDs = selectedFaces.map(face => face.face_url);
  const selectedFaceIDs = selectedFaces.map(face => face.face_id);

  useEffect(() => {
    if (isOpen) {
      fetchPeople(dispatch);
    }
  }, [isOpen, dispatch]);

  function personExist(name: string) {
    return people.map(person => person.text.toLowerCase().trim()).includes(name.toLowerCase().trim());
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
              personExist(newPersonName) ? t("personalbum.personalreadyexists", { name: newPersonName.trim() }) : ""
            }
            onChange={v => {
              setNewPersonName(v.currentTarget.value);
            }}
            placeholder={t("personedit.personname")}
          />
          <Button
            onClick={() => {
              dispatch(
                api.endpoints.setFacesPersonLabel.initiate({ faceIds: selectedFaceIDs, personName: newPersonName })
              );
              showNotification({
                message: i18n.t<string>("toasts.addfacestoperson", {
                  numberOfFaces: selectedFaceIDs.length,
                  personName: newPersonName,
                }),
                title: i18n.t<string>("toasts.addfacestopersontitle"),
                color: "teal",
              });
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
          {filteredPeopleList.length > 0 &&
            filteredPeopleList.map(item => (
              <Group key={item.key}>
                <Avatar radius="xl" size={60} src={serverAddress + item.face_url} />
                <div>
                  <Title
                    style={{ width: "250px", textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden" }}
                    order={4}
                    onClick={() => {
                      dispatch(
                        api.endpoints.setFacesPersonLabel.initiate({ faceIds: selectedFaceIDs, personName: item.text })
                      );
                      showNotification({
                        message: i18n.t<string>("toasts.addfacestoperson", {
                          numberOfFaces: selectedFaceIDs.length,
                          personName: item.text,
                        }),
                        title: i18n.t<string>("toasts.addfacestopersontitle"),
                        color: "teal",
                      });
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
}
