import type { ErrorReport } from "@librephotos/api-client";
import { Badge, Button, Group, Stack, Text } from "@mantine/core";
import { IconDownload, IconMail, IconSend, IconTrash } from "@tabler/icons-react";
import { DateTime } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";
import {
  saveErrorReportFile,
  useDeleteErrorReportMutation,
  useSendErrorReportMutation,
} from "../../api_client/errorReports";
import { notification } from "../../service/notifications";
import { ICON_SIZE } from "../../uiConstants";
import { parseInstant } from "../../util/dateUtils";
import { errorReportMailto, sourceLabel } from "./errorReportEmail";
import classes from "./ErrorReportRow.module.css";

/**
 * One saved error report (#2938): what failed, where and when, whether it was sent, and Send once,
 * Download, Email and Delete. Email opens a mail to the maintainers; mail links cannot attach the
 * file, so Download sits next to it.
 */
export function ErrorReportRow({ report }: Readonly<{ report: ErrorReport }>) {
  const { t } = useTranslation();
  const send = useSendErrorReportMutation();
  const remove = useDeleteErrorReportMutation();
  const lastSeen = parseInstant(report.last_seen).toLocaleString(DateTime.DATETIME_MED);

  return (
    <Stack gap={6} py="sm" data-testid="error-report">
      <Text fz="sm" fw={500} lineClamp={3} className={classes.title}>
        {report.title}
      </Text>
      <Group gap="xs">
        <Badge size="sm" variant="light" color="gray">
          {sourceLabel(report.source, t)}
        </Badge>
        {report.sent_at === null ? (
          <Badge size="sm" variant="light" color="orange">
            {t("errorreports.not_sent")}
          </Badge>
        ) : (
          <Badge size="sm" variant="light" color="teal">
            {t("errorreports.sent")}
          </Badge>
        )}
        <Text fz="xs" c="dimmed">
          {lastSeen} · {t("errorreports.times", { count: report.occurrences })} ·{" "}
          {t("errorreports.release", { release: report.release })}
        </Text>
      </Group>
      <Group gap="xs">
        <Button
          size="xs"
          variant="light"
          leftSection={<IconSend size={ICON_SIZE.menu} />}
          loading={send.isPending}
          onClick={() =>
            send.mutate(report.id, { onSuccess: () => notification.success(t("errorreports.sent_toast")) })
          }
        >
          {t("errorreports.send_once")}
        </Button>
        <Button
          size="xs"
          variant="default"
          leftSection={<IconDownload size={ICON_SIZE.menu} />}
          onClick={() => void saveErrorReportFile(report.id).catch(() => undefined)}
        >
          {t("errorreports.download")}
        </Button>
        <Button
          size="xs"
          variant="default"
          component="a"
          href={errorReportMailto(report, t)}
          leftSection={<IconMail size={ICON_SIZE.menu} />}
        >
          {t("errorreports.email")}
        </Button>
        <Button
          size="xs"
          variant="subtle"
          color="red"
          leftSection={<IconTrash size={ICON_SIZE.menu} />}
          loading={remove.isPending}
          onClick={() => remove.mutate(report.id)}
        >
          {t("errorreports.delete")}
        </Button>
      </Group>
    </Stack>
  );
}

/** Under the list: why Email needs Download. */
export function EmailHint() {
  const { t } = useTranslation();
  return (
    <Text fz="xs" c="dimmed">
      {t("errorreports.email_hint")}
    </Text>
  );
}
