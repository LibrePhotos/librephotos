import type { Job, User, WriteMetadataPreview } from "@librephotos/api-client";
import { Anchor, Button, Flex, Group, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconFilePencil } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { useWriteMetadataToFiles } from "../../api_client/jobs/hooks";
import { useWriteMetadataPreviewQuery } from "../../api_client/settings";
import { DisabledReason } from "../common/DisabledReason";
import { ACTION_MIN_WIDTH } from "./libraryLayout";
import { labelledCounts, listWrittenTypes } from "./writeExistingEdits";
import classes from "./WriteExistingEditsRow.module.css";
import { WriteMetadataModal } from "./WriteMetadataModal";

type Props = Readonly<{
  /** The user as saved: the job writes with the saved settings. */
  saved: User;
  /** The user as edited on the page, not saved yet. */
  edited: User;
}>;

/** Whether the page has a change of the settings the job writes with that is not saved yet. */
function hasUnsavedChange(saved: User, edited: User): boolean {
  return (
    saved.save_metadata_to_disk !== edited.save_metadata_to_disk ||
    saved.save_face_tags_to_disk !== edited.save_face_tags_to_disk
  );
}

/** Why the button cannot be used now, or undefined. */
function blockedReason(
  saved: User,
  edited: User,
  preview: WriteMetadataPreview | undefined,
  t: TFunction
): string | undefined {
  if (edited.save_metadata_to_disk === "OFF") return t("settings.writeexisting.off");
  if (hasUnsavedChange(saved, edited)) return t("settings.writeexisting.unsaved");
  if (preview?.target === null) return t("settings.writeexisting.off");
  if (preview?.total === 0) return t("settings.writeexisting.nothing");
  return undefined;
}

function RunningLine({ job }: Readonly<{ job: Job }>) {
  const { t } = useTranslation();
  return (
    <Group gap="xs">
      <Text size="xs" c="dimmed">
        {t("settings.writeexisting.running", { current: job.progress_current, target: job.progress_target })}
      </Text>
      <Anchor size="xs" renderRoot={props => <Link to="/jobs/$id" params={{ id: String(job.id) }} {...props} />}>
        {t("adminarea.viewjob")}
      </Anchor>
    </Group>
  );
}

/**
 * "Write existing edits to files" under the write choice in Metadata Options (#2287): "Write edits to
 * files" only writes edits made after it was turned on, and this writes the ones LibrePhotos already
 * holds, as a job. It follows the saved setting, so it waits while the choice has an unsaved change.
 */
export function WriteExistingEditsRow({ saved, edited }: Props) {
  const { t, i18n } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);
  const preview = useWriteMetadataPreviewQuery(saved.save_metadata_to_disk, saved.save_face_tags_to_disk);
  const { start, running, job } = useWriteMetadataToFiles();
  const data = preview.data;
  const reason = blockedReason(saved, edited, data, t);
  const description =
    reason ??
    (data
      ? t(data.target === "media_file" ? "settings.writeexisting.mediafile" : "settings.writeexisting.sidecar", {
          count: data.total,
          fields: listWrittenTypes(data.counts, t, i18n.language),
        })
      : "");

  return (
    <Flex className={classes.row} justify="space-between" align="center" gap="md" wrap="wrap">
      <Stack gap={2} flex="1 1 260px">
        <Text size="sm">{t("settings.writeexisting.title")}</Text>
        <Text size="xs" c="dimmed">
          {description}
        </Text>
        {job && !job.finished ? <RunningLine job={job} /> : null}
      </Stack>
      <DisabledReason reason={reason}>
        <Button
          variant="outline"
          leftSection={<IconFilePencil size={16} />}
          loading={running || preview.isLoading}
          miw={ACTION_MIN_WIDTH}
          onClick={open}
        >
          {t("settings.writeexisting.button")}
        </Button>
      </DisabledReason>
      {data?.target ? (
        <WriteMetadataModal
          opened={opened}
          onClose={close}
          onConfirm={() => {
            close();
            start();
          }}
          target={data.target}
          counts={labelledCounts(data.counts, t)}
          total={data.total}
        />
      ) : null}
    </Flex>
  );
}
