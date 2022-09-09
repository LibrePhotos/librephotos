import { Chip, Divider, Group, Stack, Text } from "@mantine/core";
import _ from "lodash";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  cell: any;
  width: number;
  style: any;
  key: any;
  entrySquareSize: number;
  setSelectedFaces: any;
  selectedFaces: any;
};

export function HeaderComponent(props: Props) {
  const { t } = useTranslation();
  const { cell, width } = props;

  const [checked, setChecked] = useState(false);
  const { entrySquareSize, setSelectedFaces, selectedFaces } = props;
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

  useEffect(() => {
    //deselect when no faces of the current group are selected
    const selectedFacesOfGroup = selectedFaces.filter(i => cell.faces.filter(j => j.id === i.face_id).length > 0);
    if (selectedFacesOfGroup.length === 0) {
      setChecked(false);
    }
  }, [selectedFaces]);

  return (
    <Stack
      key={props.key}
      spacing="xs"
      style={{
        ...props.style,
        width: width,
        paddingTop: entrySquareSize / 2.0 - 35,
        height: entrySquareSize,
      }}
    >
      <Group>
        <Chip variant="filled" radius="xs" size="lg" checked={checked} onChange={handleClick}>
          {cell.name}
        </Chip>
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
