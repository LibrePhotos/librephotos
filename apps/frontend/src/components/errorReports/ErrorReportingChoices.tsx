import { Button, Stack, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { DisabledReason } from "../common/DisabledReason";
import type { ErrorReportingMode } from "./errorReportingMode";

/** The few lines on error reporting the first-time setup and the one-time question show (#2938). */
export function ErrorReportingIntro() {
  const { t } = useTranslation();
  return (
    <Stack gap={6}>
      <Text fz="sm">{t("errorreports.intro_purpose")}</Text>
      <Text fz="sm">{t("errorreports.intro_consent")}</Text>
      <Text fz="sm" c="dimmed">
        {t("errorreports.intro_contents")}
      </Text>
    </Stack>
  );
}

type Props = Readonly<{
  /** Which choices the server can carry out; off always can. */
  ownServer: boolean;
  maintainers: boolean;
  onChoose: (mode: ErrorReportingMode) => void;
}>;

/**
 * The three choices as buttons, each saving at once: Off first and filled, so keeping reports on
 * the server is one click; a server the environment does not name says why it cannot be picked.
 */
export function ErrorReportingChoices({ ownServer, maintainers, onChoose }: Props) {
  const { t } = useTranslation();
  return (
    <Stack gap="xs">
      <Button fullWidth onClick={() => onChoose("off")}>
        {t("errorreports.off")}
      </Button>
      <DisabledReason reason={maintainers ? null : t("errorreports.maintainers_unavailable")}>
        <Button fullWidth variant="light" onClick={() => onChoose("maintainers")}>
          {t("errorreports.maintainers")}
        </Button>
      </DisabledReason>
      <DisabledReason reason={ownServer ? null : t("errorreports.own_server_unavailable")}>
        <Button fullWidth variant="light" onClick={() => onChoose("own_server")}>
          {t("errorreports.own_server")}
        </Button>
      </DisabledReason>
    </Stack>
  );
}
