import { Button, Group, Text } from "@mantine/core";
import type { ReactNode } from "react";
import React from "react";
import { useTranslation } from "react-i18next";

type Props = Readonly<{
  message: ReactNode;
  onUndo: () => void;
}>;

/**
 * A toast's message with an Undo button next to it (#127). The button is a real button, so it is
 * reachable with Tab, and Mantine keeps the toast open while it is hovered.
 */
export function ToastWithUndo({ message, onUndo }: Props) {
  const { t } = useTranslation();
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Text size="sm">{message}</Text>
      <Button variant="subtle" size="compact-sm" onClick={onUndo}>
        {t("toasts.undo")}
      </Button>
    </Group>
  );
}
