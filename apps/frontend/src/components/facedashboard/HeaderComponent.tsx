import { ActionIcon, Chip, Divider, Group, Stack, Text, Tooltip } from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import _ from "lodash";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { UserCheck } from "tabler-icons-react";

import { api } from "../../api_client/api";
import i18n from "../../i18n";
import { useAppDispatch, useAppSelector } from "../../store/store";

type Props = {
  cell: any;
  width: number;
  style: any;
  entrySquareSize: number;
  setSelectedFaces: any;
  selectedFaces: any;
};

export function HeaderComponent({ cell, width, style, entrySquareSize, setSelectedFaces, selectedFaces }: Props) {
  const { activeTab } = useAppSelector(store => store.face);
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const [checked, setChecked] = useState(false);

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
    const personName = cell.name;
    dispatch(api.endpoints.setFacesPersonLabel.initiate({ faceIds: facesToAddIDs, personName: personName }));
    showNotification({
      message: i18n.t<string>("toasts.addfacestoperson", {
        numberOfFaces: facesToAddIDs.length,
        personName: personName,
      }),
      title: i18n.t<string>("toasts.addfacestopersontitle"),
      color: "teal",
    });
  };

  useEffect(() => {
    // deselect when no faces of the current group are selected
    const selectedFacesOfGroup = selectedFaces.filter(i => cell.faces.filter(j => j.id === i.face_id).length > 0);
    if (selectedFacesOfGroup.length === 0) {
      setChecked(false);
    }
  }, [cell.faces, selectedFaces]);

  return (
    <Stack
      spacing="xs"
      style={{
        ...style,
        width: width,
        paddingTop: entrySquareSize / 2.0 - 35,
        height: entrySquareSize,
      }}
    >
      <Group>
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
        <Text color="dimmed">
          {t("facesdashboard.numberoffaces", {
            number: cell.faces.length,
          })}
        </Text>
      </Group>
      <Divider />
    </Stack>
  );
}
