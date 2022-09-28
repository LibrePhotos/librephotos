import { Group, Text } from "@mantine/core";
import React from "react";

export function FileInfoComponent(props: { description?: string; info: string | undefined }) {
  const { description, info } = props;

  if (!info || info.includes("undefined") || info.includes("null") || info.includes("0 mm")) return null;
  if (!description) {
    return (
      <Text size="xs" color="dimmed">
        {info}
      </Text>
    );
  }
  return (
    <Group>
      <Text size="xs" color="dimmed">
        {description}
      </Text>
      <Text size="xs">{info}</Text>
    </Group>
  );
}
