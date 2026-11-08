import type { SiteSettings } from "@librephotos/api-client";
import { Anchor, Button, Modal, Stack, Text } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { DIALOG_SIZE } from "../modals/dialogSize";
import { modalTitleStyles } from "../modals/modalTitleStyles";
import { useSaveSiteSettings } from "../settings/useSaveSiteSettings";
import { ErrorReportingChoices, ErrorReportingIntro } from "./ErrorReportingChoices";
import { modeOf } from "./errorReportingMode";
import { ErrorReportingOptInModal } from "./ErrorReportingOptInModal";
import { useErrorReportingChoice } from "./useErrorReportingChoice";

type Props = Readonly<{
  settings: Pick<SiteSettings, "error_reporting" | "error_reporting_own_server" | "error_reporting_maintainers">;
}>;

/**
 * The one-time question for an instance from before error reporting (#2938): the same few lines and
 * choices as the first-time setup, plus Not now. Every way out is saved on the server, which marks
 * the question answered; closing the dialog is Not now. With saved reports, it links to them, and
 * sharing asks first whether they go too.
 */
export function ErrorReportingPromptModal({ settings }: Props) {
  const { t } = useTranslation();
  const save = useSaveSiteSettings();
  const { choose, unsent, optIn } = useErrorReportingChoice({ current: modeOf(settings.error_reporting) });
  const notNow = () => save({ error_reporting_asked: true });

  return (
    <>
      <Modal
        opened={!optIn.opened}
        onClose={notNow}
        title={t("errorreports.prompt_title")}
        size={DIALOG_SIZE.sm}
        styles={modalTitleStyles}
      >
        <Stack gap="md">
          <ErrorReportingIntro />
          {unsent.length > 0 ? (
            <Anchor component={Link} to="/admin/error-reports" fz="sm" onClick={notNow}>
              {t("errorreports.prompt_review", { count: unsent.length })}
            </Anchor>
          ) : null}
          <ErrorReportingChoices
            ownServer={settings.error_reporting_own_server === true}
            maintainers={settings.error_reporting_maintainers === true}
            onChoose={choose}
          />
          <Button variant="subtle" color="gray" onClick={notNow}>
            {t("errorreports.prompt_not_now")}
          </Button>
          <Text fz="xs" c="dimmed">
            {t("errorreports.intro_later")}
          </Text>
        </Stack>
      </Modal>
      <ErrorReportingOptInModal {...optIn} />
    </>
  );
}
