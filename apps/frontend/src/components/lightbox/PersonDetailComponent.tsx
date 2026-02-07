import { ActionIcon, Avatar, Button, Group, Indicator, Text, Tooltip } from "@mantine/core";
import { IconEdit, IconTrash, IconUserCheck, IconUserOff } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/apiClient";
import { useDeleteFacesMutation, useSetFacesPersonLabelMutation } from "../../api_client/faces";
import { notification } from "../../service/notifications";
import { calculateProbabiltyColor } from "../facedashboard/FaceComponent";
import { FaceTooltip } from "../facedashboard/FaceTooltip";

type Props = {
  person: any;
  isPublic: boolean;
  setFaceLocation: (face: any) => void;
  onPersonEdit: (faceId: string, faceUrl: string) => void;
  notThisPerson: (faceId: number) => void;
};

export function PersonDetail({ person, isPublic, setFaceLocation, onPersonEdit, notThisPerson }: Props) {
  const { t } = useTranslation();
  const [tooltipOpened, setTooltipOpened] = useState(false);
  const { mutate: setFacesPersonLabel } = useSetFacesPersonLabelMutation();
  const { mutate: deleteFaces } = useDeleteFacesMutation();
  const navigate = useNavigate();

  return (
    <Group
      align="center"
      gap="xs"
      key={person.name}
      onMouseEnter={() => setFaceLocation(person.location)}
      onMouseLeave={() => setFaceLocation(null)}
    >
      <Button
        variant="subtle"
        h="auto"
        p={3}
        leftSection={
          <FaceTooltip tooltipOpened={tooltipOpened} probability={person.probability}>
            <Indicator
              color={calculateProbabiltyColor(person.probability)}
              disabled={person.type === "user"}
              onMouseEnter={() => person.type !== "user" && setTooltipOpened(true)}
              onMouseLeave={() => setTooltipOpened(false)}
              size={12}
              offset={4}
            >
              <Avatar radius="xl" src={`${serverAddress}${person.face_url}`} />
            </Indicator>
          </FaceTooltip>
        }
        onClick={() => !isPublic && navigate({ to: `/search/${person.name}` })}
      >
        <Text size="sm">{person.name}</Text>
      </Button>
      {!isPublic && person.type !== "user" && (
        <Tooltip label={t("facesdashboard.explanationadding")}>
          <ActionIcon
            onClick={() => setFacesPersonLabel({ faceIds: [person.face_id], personName: person.name })}
            variant="light"
            color="green"
          >
            <IconUserCheck />
          </ActionIcon>
        </Tooltip>
      )}
      {!isPublic && (
        <Tooltip label={t("facesdashboard.explanationadding")}>
          <ActionIcon onClick={() => onPersonEdit(person.face_id, person.face_url)} variant="light">
            <IconEdit />
          </ActionIcon>
        </Tooltip>
      )}
      {!isPublic && (
        <Tooltip label={t("facesdashboard.notthisperson")}>
          <ActionIcon variant="light" color="orange" onClick={() => notThisPerson(person.face_id)}>
            <IconUserOff />
          </ActionIcon>
        </Tooltip>
      )}
      {!isPublic && person.type !== "user" && (
        <Tooltip label={t("facesdashboard.explanationdeleting")}>
          <ActionIcon
            variant="light"
            color="red"
            onClick={() => {
              deleteFaces({ faceIds: [person.face_id] });
              notification.deleteFaces(1);
            }}
          >
            <IconTrash />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
}
