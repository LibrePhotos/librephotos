import { Group, Text } from "@mantine/core";
import React from "react";

export function FileInfoComponent({
  description = "",
  info,
}: Readonly<{ description?: string; info: string | undefined }>) {
  if (!info || info.includes("undefined") || info.includes("null") || info.includes("0 mm")) return null;
  if (!description) {
    return (
      <Text size="xs" c="dimmed" lineClamp={1} style={{ maxWidth: 100 }}>
        {info}
      </Text>
    );
  }
  return (
    <Group>
      <Text size="xs" c="dimmed">
        {description}
      </Text>
      <Text size="xs">{info}</Text>
    </Group>
  );
}
