import { ActionIcon, Avatar, Button, Group, Indicator, Text, Tooltip } from "@mantine/core";
import {
  IconEdit as Edit,
  IconTrash as Trash,
  IconUserCheck as UserCheck,
  IconUserOff as UserOff,
} from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { push } from "redux-first-history";

import { api } from "../../api_client/api";
import { serverAddress } from "../../api_client/apiClient";
import { notification } from "../../service/notifications";
import { useAppDispatch } from "../../store/store";
import { calculateProbabiltyColor } from "../facedashboard/FaceComponent";
import { FaceTooltip } from "../facedashboard/FaceTooltip";

type PersonDetailProps = {
  person: any;
  isPublic: boolean;
  setFaceLocation: (face: any) => void;
  onPersonEdit: (faceId: string, faceUrl: string) => void;
  notThisPerson: (faceId: string) => void;
};

export const PersonDetail: React.FC<PersonDetailProps> = ({
  person,
  isPublic,
  setFaceLocation,
  onPersonEdit,
  notThisPerson,
}) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [tooltipOpened, setTooltipOpened] = useState(false);

  return (
    <Group
      position="center"
      spacing="xs"
      key={person.name}
      onMouseEnter={() => setFaceLocation(person.location)}
      onMouseLeave={() => setFaceLocation(null)}
    >
      <Button
        variant="subtle"
        leftIcon={
          <FaceTooltip tooltipOpened={tooltipOpened} probability={person.probability}>
            <Indicator
              color={calculateProbabiltyColor(person.probability)}
              disabled={person.type === "user"}
              onMouseEnter={() => person.type !== "user" && setTooltipOpened(true)}
              onMouseLeave={() => setTooltipOpened(false)}
            >
              <Avatar radius="xl" src={`${serverAddress}${person.face_url}`} />
            </Indicator>
          </FaceTooltip>
        }
        onClick={() => !isPublic && dispatch(push(`/search/${person.name}`))}
      >
        <Text align="center" size="sm">
          {person.name}
        </Text>
      </Button>
      {!isPublic && person.type !== "user" && (
        <Tooltip label={t("facesdashboard.explanationadding")}>
          <ActionIcon
            onClick={() =>
              dispatch(
                api.endpoints.setFacesPersonLabel.initiate({ faceIds: [person.face_id], personName: person.name })
              )
            }
            variant="light"
            color="green"
          >
            <UserCheck />
          </ActionIcon>
        </Tooltip>
      )}
      {!isPublic && (
        <Tooltip label={t("facesdashboard.explanationadding")}>
          <ActionIcon onClick={() => onPersonEdit(person.face_id, person.face_url)} variant="light">
            <Edit />
          </ActionIcon>
        </Tooltip>
      )}
      {!isPublic && (
        <Tooltip label={t("facesdashboard.notthisperson")}>
          <ActionIcon variant="light" color="orange" onClick={() => notThisPerson(person.face_id)}>
            <UserOff />
          </ActionIcon>
        </Tooltip>
      )}
      {!isPublic && person.type !== "user" && (
        <Tooltip label={t("facesdashboard.explanationdeleting")}>
          <ActionIcon
            variant="light"
            color="red"
            onClick={() => {
              dispatch(api.endpoints.deleteFaces.initiate({ faceIds: [person.face_id] }));
              notification.deleteFaces(1);
            }}
          >
            <Trash />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
};
