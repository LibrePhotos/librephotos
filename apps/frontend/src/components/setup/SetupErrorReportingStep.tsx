import { Stack, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { ErrorReportingChoices, ErrorReportingIntro } from "../errorReports/ErrorReportingChoices";
import { modeOf } from "../errorReports/errorReportingMode";
import { ErrorReportingOptInModal } from "../errorReports/ErrorReportingOptInModal";
import { useErrorReportingChoice } from "../errorReports/useErrorReportingChoice";

/**
 * The first-time setup's error reporting step (#2938): a few lines on what reports are for and
 * hold, and the three choices. A choice is saved through the site setting, which also marks the
 * question answered, so this admin is never asked again; then the setup moves on.
 */
export function SetupErrorReportingStep({ onDone }: Readonly<{ onDone: () => void }>) {
  const { t } = useTranslation();
  const { data: settings } = useGetSettingsQuery();
  const { choose, optIn } = useErrorReportingChoice({ current: modeOf(settings?.error_reporting), onSaved: onDone });
  return (
    <Stack gap="md">
      <ErrorReportingIntro />
      <ErrorReportingChoices
        ownServer={settings?.error_reporting_own_server === true}
        maintainers={settings?.error_reporting_maintainers === true}
        onChoose={choose}
      />
      <Text fz="xs" c="dimmed">
        {t("errorreports.intro_later")}
      </Text>
      <ErrorReportingOptInModal {...optIn} />
    </Stack>
  );
}
