import { Group, Kbd, Paper, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import classes from "./ChordHint.module.css";
import { CHORD_KEY, goToShortcuts } from "./goToShortcuts";

/** Shown after `g` (#2037): the keys that finish the chord, so nobody has to learn them first. */
export function ChordHint({ isAdmin }: Readonly<{ isAdmin: boolean }>) {
  const { t } = useTranslation();
  return (
    <Paper className={classes.hint} shadow="md" withBorder radius="md" px="md" py="xs" role="status">
      <Group gap="md" wrap="wrap" justify="center">
        <Text size="sm" fw={600}>
          {t("shortcuts.goto")} <Kbd size="xs">{CHORD_KEY}</Kbd>
        </Text>
        {goToShortcuts(isAdmin).map(shortcut => (
          <Group key={shortcut.key} gap={4} wrap="nowrap">
            <Kbd size="xs">{shortcut.key}</Kbd>
            <Text size="sm">{t(shortcut.label)}</Text>
          </Group>
        ))}
      </Group>
    </Paper>
  );
}
