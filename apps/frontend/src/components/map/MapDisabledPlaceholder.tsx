import { Center, Stack, Text } from "@mantine/core";
import { IconMapOff } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";

type Props = Readonly<{
  height?: number | string;
}>;

/**
 * Shown in place of a map when the admin has set the map tile provider to "None"
 * (or "Custom" without a URL). Keeps the layout stable and explains why the map
 * is absent instead of rendering a blank grey canvas.
 */
export function MapDisabledPlaceholder({ height = 200 }: Props) {
  const { t } = useTranslation();
  return (
    <Center
      style={{
        height,
        width: "100%",
        border: "1px solid var(--mantine-color-gray-3)",
        borderRadius: "var(--mantine-radius-sm)",
        background: "var(--mantine-color-gray-0)",
      }}
    >
      <Stack align="center" gap={4}>
        <IconMapOff size={28} color="var(--mantine-color-gray-5)" />
        <Text size="sm" c="dimmed" ta="center">
          {t("map.display_disabled", "Map display is turned off in site settings.")}
        </Text>
      </Stack>
    </Center>
  );
}
