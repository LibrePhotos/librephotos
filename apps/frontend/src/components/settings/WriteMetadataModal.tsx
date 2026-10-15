import type { WriteMetadataTarget } from "@librephotos/api-client";
import { Button, Group, Modal, Paper, Stack, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { modalTitleStyles } from "../modals/modalTitleStyles";
import type { LabelledCount } from "./writeExistingEdits";
import classes from "./WriteMetadataModal.module.css";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
  target: WriteMetadataTarget;
  counts: readonly LabelledCount[];
  total: number;
}>;

/**
 * Asks before "Write metadata to files" (#2287) writes, naming where and how much. Into sidecars it is
 * a plain confirm; into the media files the button is red like `ConfirmModal`'s, because originals
 * change. Focus starts on Cancel.
 */
export function WriteMetadataModal({ opened, onClose, onConfirm, target, counts, total }: Props) {
  const { t } = useTranslation();
  const media = target === "media_file";

  return (
    <Modal
      styles={modalTitleStyles}
      opened={opened}
      onClose={onClose}
      centered
      size="md"
      title={
        media
          ? t("settings.writeexisting.mediafiletitle", { count: total })
          : t("settings.writeexisting.sidecartitle", { count: total })
      }
    >
      <Stack gap="sm">
        <Text size="sm">
          {media ? t("settings.writeexisting.mediafilemessage") : t("settings.writeexisting.sidecarmessage")}
        </Text>
        <Paper withBorder p="sm">
          <Stack gap={6}>
            {counts.map(({ type, label, photos }) => (
              <Group key={type} justify="space-between" gap="xs" wrap="nowrap">
                <Text size="sm">{label}</Text>
                <Text size="sm" c="dimmed">
                  {t("settings.writeexisting.photos", { count: photos })}
                </Text>
              </Group>
            ))}
          </Stack>
        </Paper>
        <div className={classes.actions}>
          <Button variant="default" onClick={onClose} data-autofocus>
            {t("cancel")}
          </Button>
          <Button color={media ? "red" : undefined} onClick={onConfirm}>
            {media ? t("settings.writeexisting.mediafileconfirm") : t("settings.writeexisting.sidecarconfirm")}
          </Button>
        </div>
      </Stack>
    </Modal>
  );
}
