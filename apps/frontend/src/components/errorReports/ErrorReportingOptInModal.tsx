import type { ErrorReport } from "@librephotos/api-client";
import { Button, Group, List, Modal, ScrollArea, Stack, Text } from "@mantine/core";
import { DateTime } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";
import { parseInstant } from "../../util/dateUtils";
import { DIALOG_SIZE } from "../modals/dialogSize";
import { modalTitleStyles } from "../modals/modalTitleStyles";
import type { SendingMode } from "./errorReportingMode";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** Where new reports will go. */
  destination: SendingMode;
  /** The saved reports not sent yet, shown before the admin decides. */
  reports: readonly ErrorReport[];
  /** Turn sharing on; `true` also sends the saved reports. */
  onChoose: (sendSaved: boolean) => void;
}>;

/**
 * Turning error reporting on (#2938) asks on its own whether the reports saved so far go too, and
 * lists them first. Either answer turns sharing on; Cancel leaves the setting as it was.
 */
export function ErrorReportingOptInModal({ opened, onClose, destination, reports, onChoose }: Props) {
  const { t } = useTranslation();
  const description =
    destination === "maintainers"
      ? t("errorreports.optin_description_maintainers", { count: reports.length })
      : t("errorreports.optin_description_own_server", { count: reports.length });
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("errorreports.optin_title")}
      size={DIALOG_SIZE.md}
      styles={modalTitleStyles}
    >
      <Stack gap="md">
        <Text fz="sm">{description}</Text>
        <ScrollArea.Autosize mah={240} type="auto">
          {/* At most 30: the server keeps no more. */}
          <List fz="sm" spacing={4}>
            {reports.map(report => (
              <List.Item key={report.id}>
                <Text fz="sm" lineClamp={2}>
                  {report.title}
                </Text>
                <Text fz="xs" c="dimmed">
                  {parseInstant(report.last_seen).toLocaleString(DateTime.DATETIME_MED)}
                </Text>
              </List.Item>
            ))}
          </List>
        </ScrollArea.Autosize>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>
            {t("errorreports.cancel")}
          </Button>
          <Button variant="light" onClick={() => onChoose(false)}>
            {t("errorreports.optin_new_only")}
          </Button>
          <Button onClick={() => onChoose(true)}>{t("errorreports.optin_send_saved")}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
