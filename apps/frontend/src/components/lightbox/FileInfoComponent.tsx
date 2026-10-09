import { Group, Text } from "@mantine/core";
import React from "react";

export function FileInfoComponent({
  description = "",
  info,
  size = "xs",
  width,
}: Readonly<{ description?: string; info: string | undefined; size?: string; width?: number }>) {
  // Callers build the text from fields that may be missing ("null mm",
  // "ISOundefined", "NaN mm"). A zero focal length is missing too, but only an
  // exact "0 mm": 50 mm or a "24-70 mm" lens name must still show.
  if (!info || info.includes("undefined") || info.includes("null") || info.includes("NaN") || info.trim() === "0 mm")
    return null;

  // Calculate maxWidth based on size
  const getMaxWidth = () => {
    switch (size) {
      case "xs":
        return 100;
      case "sm":
        return 150;
      case "md":
        return 200;
      case "lg":
        return 250;
      case "xl":
        return 300;
      default:
        return 100;
    }
  };

  if (!description) {
    return (
      <Text size={size} c="dimmed" lineClamp={1} style={{ maxWidth: width || getMaxWidth() }}>
        {info}
      </Text>
    );
  }
  return (
    <Group>
      <Text size={size} c="dimmed">
        {description}
      </Text>
      <Text size={size}>{info}</Text>
    </Group>
  );
}
