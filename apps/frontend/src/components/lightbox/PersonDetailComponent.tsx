import { ActionIcon, Avatar, Button, Group, Indicator, Text, Tooltip } from "@mantine/core";
import { IconEdit, IconTrash, IconUserCheck, IconUserOff, IconUserQuestion } from "@tabler/icons-react";
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

  // A face nobody has named yet, and that neither clustering nor classification
  // guessed a name for. It still belongs in this list -- it is the only place
  // where a face the algorithms gave up on can be named -- but it has no name to
  // show, no confidence to explain, and nothing to confirm or reject.
  const isUnnamed = !person.name;

  // A cluster row's label is the cluster's own name -- clustering calls every
  // unnamed cluster "Unknown 001" and so on -- not the name of whoever is in the
  // photo. Confirming it asks the backend for a *person* by that name, which is
  // not a person anyone has. The face dashboard has always hidden confirm for
  // CLUSTER and UNKNOWN kinds; this is the same row seen from the photo.
  const isClusterLabel = person.type === "cluster";

  const openPersonPicker = () => onPersonEdit(person.face_id, person.face_url);

  return (
    <Group
      align="center"
      gap="xs"
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
              disabled={person.type === "user" || isUnnamed}
              onMouseEnter={() => person.type !== "user" && !isUnnamed && setTooltipOpened(true)}
              onMouseLeave={() => setTooltipOpened(false)}
              size={12}
              offset={4}
            >
              <Avatar radius="xl" src={`${serverAddress}${person.face_url}`} />
            </Indicator>
          </FaceTooltip>
        }
        // An unnamed face has no person album and no search term to navigate to,
        // so the whole row is the affordance for naming it instead.
        onClick={() => {
          if (isPublic) return;
          if (isUnnamed) {
            openPersonPicker();
          } else {
            navigate({ to: `/search/${person.name}` });
          }
        }}
      >
        <Text size="sm" c={isUnnamed ? "dimmed" : undefined} fs={isUnnamed ? "italic" : undefined}>
          {isUnnamed ? t("lightbox.sidebar.unnamedface") : person.name}
        </Text>
      </Button>
      {!isPublic && !isUnnamed && !isClusterLabel && person.type !== "user" && (
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
        <Tooltip label={isUnnamed ? t("lightbox.sidebar.nameface") : t("facesdashboard.explanationadding")}>
          <ActionIcon onClick={openPersonPicker} variant={isUnnamed ? "filled" : "light"}>
            {isUnnamed ? <IconUserQuestion /> : <IconEdit />}
          </ActionIcon>
        </Tooltip>
      )}
      {!isPublic && !isUnnamed && (
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
