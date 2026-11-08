import { Anchor, Group, List, SegmentedControl, Stack, Text, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Link } from "@tanstack/react-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useErrorReportsQuery, useSendAllErrorReportsMutation } from "../../api_client/errorReports";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { DOCUMENTATION_LINK } from "../../uiConstants";
import { SettingsCard } from "../settings/SettingsCard";
import { SectionLink } from "../settings/SettingsSection";
import { useSaveSiteSettings } from "../settings/useSaveSiteSettings";
import { ERROR_REPORTING_DOCS, modeOf, type ErrorReportingMode, type SendingMode } from "./errorReportingMode";
import { ErrorReportingOptInModal } from "./ErrorReportingOptInModal";
import { useSendAllToast } from "./useSendAllToast";

/** Exactly what a report holds and what it never does, as the docs page lists it. */
function WhatIsSent() {
  const { t } = useTranslation();
  return (
    <Stack gap={4}>
      <Text fz="sm" fw={500}>
        {t("errorreports.what_is_sent")}
      </Text>
      <List fz={13} c="dimmed" spacing={2} maw="72ch">
        <List.Item>{t("errorreports.sent_error")}</List.Item>
        <List.Item>{t("errorreports.sent_versions")}</List.Item>
        <List.Item>{t("errorreports.sent_request")}</List.Item>
      </List>
      <Text fz={13} c="dimmed" maw="72ch">
        {t("errorreports.never_sent")} {t("errorreports.server_sees_ip")}{" "}
        <Anchor href={DOCUMENTATION_LINK + ERROR_REPORTING_DOCS} target="_blank" rel="noreferrer" fz={13}>
          {t("errorreports.docs")}
        </Anchor>
      </Text>
    </Stack>
  );
}

/**
 * Error reporting on the Admin page (#2938): off (the default), the admin's own server, or the
 * LibrePhotos maintainers. Turning it on with reports saved asks first whether those go too.
 * Hidden for an older backend without error reporting.
 */
export function ErrorReportingCard() {
  const { t } = useTranslation();
  const { data: settings } = useGetSettingsQuery();
  const available = settings?.error_reporting !== undefined;
  const { data: reports = [] } = useErrorReportsQuery({ enabled: available });
  const save = useSaveSiteSettings();
  const sendAll = useSendAllErrorReportsMutation();
  const sendAllToast = useSendAllToast();
  const [pending, setPending] = useState<SendingMode | null>(null);
  const [optInOpen, { open, close }] = useDisclosure(false);
  if (!available) return null;
  const stored = modeOf(settings.error_reporting);
  const unsent = reports.filter(report => report.sent_at === null);
  const usable: Record<ErrorReportingMode, boolean> = {
    off: true,
    own_server: settings.error_reporting_own_server === true,
    maintainers: settings.error_reporting_maintainers === true,
  };

  const change = (value: string) => {
    const next = modeOf(value);
    if (next === "off" || stored !== "off" || unsent.length === 0) {
      save({ error_reporting: next });
      return;
    }
    setPending(next);
    open();
  };
  const choose = (sendSaved: boolean) => {
    if (pending !== null) {
      save({ error_reporting: pending }, sendSaved ? () => sendAll.mutate(undefined, sendAllToast) : undefined);
    }
    close();
  };

  return (
    <SettingsCard>
      <Stack gap="sm">
        <Title order={4}>
          {t("errorreports.setting")}
          <SectionLink />
        </Title>
        <Text fz="sm" c="dimmed" maw="72ch">
          {t("errorreports.setting_description")}
        </Text>
        <SegmentedControl
          aria-label={t("errorreports.setting")}
          value={stored}
          onChange={change}
          data={[
            { value: "off", label: t("errorreports.off") },
            { value: "own_server", label: t("errorreports.own_server"), disabled: !usable.own_server },
            { value: "maintainers", label: t("errorreports.maintainers"), disabled: !usable.maintainers },
          ]}
        />
        {usable.own_server ? null : (
          <Text fz="xs" c="dimmed">
            {t("errorreports.own_server_unavailable")}
          </Text>
        )}
        {usable.maintainers ? null : (
          <Text fz="xs" c="dimmed">
            {t("errorreports.maintainers_unavailable")}
          </Text>
        )}
        <WhatIsSent />
        <Group gap="xs">
          <Anchor component={Link} to="/admin/error-reports" fz="sm">
            {t("errorreports.open_list")}
          </Anchor>
          {unsent.length > 0 ? (
            <Text fz="sm" c="dimmed">
              {t("errorreports.unsent", { count: unsent.length })}
            </Text>
          ) : null}
        </Group>
        <ErrorReportingOptInModal
          opened={optInOpen}
          onClose={close}
          destination={pending ?? "maintainers"}
          reports={unsent}
          onChoose={choose}
        />
      </Stack>
    </SettingsCard>
  );
}
