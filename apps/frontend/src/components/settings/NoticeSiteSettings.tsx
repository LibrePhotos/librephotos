import { Switch } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { useSaveSiteSettings } from "./useSaveSiteSettings";
import { WhatsNewSiteSetting } from "./WhatsNewSiteSetting";

/**
 * What the app shows users by itself, in the Site Settings card: the What's new card, the admins'
 * one-time thank-you dialog (and Rewind's request on its last slide), and each user's Rewind around
 * Christmas. A switch an older backend does not send is hidden.
 */
export function NoticeSiteSettings() {
  const { t } = useTranslation();
  const { data: settings } = useGetSettingsQuery();
  const save = useSaveSiteSettings();
  const support = settings?.support_prompts_enabled;
  const rewind = settings?.rewind_enabled;
  return (
    <>
      <WhatsNewSiteSetting />
      {support === undefined ? null : (
        <Switch
          label={t("sitesettings.supportprompts")}
          description={t("sitesettings.supportprompts_description")}
          checked={support}
          onChange={() => save({ support_prompts_enabled: !support })}
        />
      )}
      {rewind === undefined ? null : (
        <Switch
          label={t("sitesettings.rewind")}
          description={t("sitesettings.rewind_description")}
          checked={rewind}
          onChange={() => save({ rewind_enabled: !rewind })}
        />
      )}
    </>
  );
}
