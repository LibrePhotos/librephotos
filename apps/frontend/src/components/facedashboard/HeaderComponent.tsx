import { Divider, Stack, Text, Title } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";

type Props = {
  cell: any;
  width: number;
  style: any;
  key: any;
  entrySquareSize: number;
};

export function HeaderComponent(props: Props) {
  const { t } = useTranslation();
  const { cell, width } = props;
  return (
    <Stack
      key={props.key}
      spacing="xs"
      style={{
        ...props.style,
        width: width,
        paddingTop: props.entrySquareSize / 2.0 - 35,
        height: props.entrySquareSize,
      }}
    >
      <div
        style={{
          paddingLeft: 5,
        }}
      >
        <Title>{cell.name}</Title>
        <Text color="dimmed">
          {t("facesdashboard.numberoffaces", {
            number: cell.faces.length,
          })}
        </Text>
      </div>
      <Divider />
    </Stack>
  );
}
