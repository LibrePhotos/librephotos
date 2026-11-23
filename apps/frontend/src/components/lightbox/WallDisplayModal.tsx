import { Group, Modal, Stack, Switch, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import React from "react";
import { useTranslation } from "react-i18next";
import { NativeTimeInput } from "../common/NativeDateInput";
import { DIALOG_SIZE } from "../modals/dialogSize";
import type { WallDisplaySettings } from "./wallDisplay";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  settings: WallDisplaySettings;
  onChange: (change: (previous: WallDisplaySettings) => WallDisplaySettings) => void;
}>;

const SWITCH_INDENT_PX = 58;

export function WallDisplayModal({ opened, onClose, settings, onChange }: Props) {
  const { t } = useTranslation();
  const finePointer = useMediaQuery("(hover: hover) and (pointer: fine)");
  const set = <Key extends keyof WallDisplaySettings>(key: Key, value: WallDisplaySettings[Key]) =>
    onChange(previous => ({ ...previous, [key]: value }));
  return (
    <Modal
      size={DIALOG_SIZE.sm}
      zIndex={1500}
      opened={opened}
      onClose={onClose}
      title={t("lightbox.walldisplay.title")}
    >
      <Stack gap="sm">
        <Switch
          label={t("lightbox.walldisplay.keepawake")}
          description={t("lightbox.walldisplay.keepawakedesc")}
          checked={settings.keepAwake}
          onChange={event => set("keepAwake", event.currentTarget.checked)}
        />
        <Switch
          label={t("lightbox.walldisplay.sleep")}
          description={t("lightbox.walldisplay.sleepdesc")}
          checked={settings.sleepEnabled}
          onChange={event => set("sleepEnabled", event.currentTarget.checked)}
        />
        {settings.sleepEnabled && (
          <Stack gap={4} pl={SWITCH_INDENT_PX}>
            <Group grow>
              <NativeTimeInput
                label={t("lightbox.walldisplay.sleepfrom")}
                value={settings.sleepStart}
                onChange={value => {
                  if (value) set("sleepStart", value);
                }}
              />
              <NativeTimeInput
                label={t("lightbox.walldisplay.wakeat")}
                value={settings.sleepEnd}
                onChange={value => {
                  if (value) set("sleepEnd", value);
                }}
              />
            </Group>
            {settings.sleepStart === settings.sleepEnd && (
              <Text size="xs" c="orange">
                {t("lightbox.walldisplay.sleepoff")}
              </Text>
            )}
          </Stack>
        )}
        <Switch
          label={t("lightbox.walldisplay.burnin")}
          description={t("lightbox.walldisplay.burnindesc")}
          checked={settings.burnInProtection}
          onChange={event => set("burnInProtection", event.currentTarget.checked)}
        />
        {finePointer && (
          <Switch
            label={t("lightbox.walldisplay.hidecursor")}
            description={t("lightbox.walldisplay.hidecursordesc")}
            checked={settings.hideCursor}
            onChange={event => set("hideCursor", event.currentTarget.checked)}
          />
        )}
      </Stack>
    </Modal>
  );
}
