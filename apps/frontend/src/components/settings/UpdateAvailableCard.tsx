import type { UpdateStatus } from "@librephotos/api-client";
import { Badge, Button, CloseButton, Group, Text, Tooltip } from "@mantine/core";
import { IconBook as Book, IconDownload as Download, IconExternalLink as ExternalLink } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSkipReleaseMutation, useSnoozeUpdateNoticeMutation } from "../../api_client/server";
import { notification } from "../../service/notifications";
import { NoticeCard } from "../common/NoticeCard";
import { publishedDate } from "./updateCheckStatus";

/** The toast after Skip this release; one at a time. */
const SKIPPED_TOAST_ID = "release-skipped";

/**
 * The Admin page's Update available card (#2311): a newer release than this server runs, with the
 * update steps for this install, its release notes, and Skip this release (until a newer one
 * comes). The close button hides it for a week. Only admins see it; the server stores both.
 */
export function UpdateAvailableCard({ status }: Readonly<{ status: UpdateStatus }>) {
  const { t } = useTranslation();
  const skip = useSkipReleaseMutation();
  const snooze = useSnoozeUpdateNoticeMutation();
  const latest = status.latest ?? "";
  const date = publishedDate(status);
  const remindLater = t("updates.remindlater");

  const skipRelease = () =>
    skip.mutate(latest, {
      onSuccess: () =>
        notification.successCounted(SKIPPED_TOAST_ID, 1, () => t("updates.skipped", { version: latest }), {
          undo: () => skip.mutateAsync(""),
        }),
    });

  return (
    <NoticeCard
      color="blue"
      icon={<Download size={20} />}
      title={t("updates.title", { version: latest })}
      badge={
        <Badge color="blue" variant="light" tt="none">
          {t("updates.versions", { current: status.current, latest })}
        </Badge>
      }
      description={
        date
          ? t("updates.published", { current: status.current, latest, date })
          : t("updates.current", { current: status.current })
      }
      actions={
        <Tooltip label={remindLater}>
          <CloseButton aria-label={remindLater} onClick={() => snooze.mutate()} />
        </Tooltip>
      }
    >
      <Group gap="xs">
        <Button
          component="a"
          href={status.how_to_update_url}
          target="_blank"
          rel="noreferrer"
          leftSection={<Book size={16} />}
        >
          {status.install_type === "windows" ? t("updates.howtoupdatewindows") : t("updates.howtoupdate")}
        </Button>
        {status.release_url ? (
          <Button
            component="a"
            href={status.release_url}
            target="_blank"
            rel="noreferrer"
            variant="default"
            leftSection={<ExternalLink size={16} />}
          >
            {t("updates.releasenotes")}
          </Button>
        ) : null}
        <Button variant="subtle" color="gray" onClick={skipRelease} loading={skip.isPending}>
          {t("updates.skip")}
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        {t("updates.privacy")}
      </Text>
    </NoticeCard>
  );
}
