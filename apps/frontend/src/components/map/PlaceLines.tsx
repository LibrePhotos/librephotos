import { Box, Group, Stack, Text } from "@mantine/core";
import React from "react";
import type { ReactNode } from "react";
import classes from "./PlaceLines.module.css";

type Props = Readonly<{
  icon: ReactNode;
  title: string;
  detail?: string;
  /** A picked place's name in bold; a pending or failed lookup dimmed. */
  tone?: "plain" | "bold" | "dimmed";
}>;

/** A place in the location picker: an icon, its name and a small line under it. */
export function PlaceLines({ icon, title, detail, tone = "plain" }: Props) {
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      <Box className={classes.icon}>{icon}</Box>
      <Stack gap={0} miw={0}>
        <Text size="sm" fw={tone === "bold" ? 600 : 400} c={tone === "dimmed" ? "dimmed" : undefined}>
          {title}
        </Text>
        {detail && (
          <Text size="xs" c="dimmed">
            {detail}
          </Text>
        )}
      </Stack>
    </Group>
  );
}
