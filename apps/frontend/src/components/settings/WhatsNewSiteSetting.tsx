import { Switch } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { useSaveSiteSettings } from "./useSaveSiteSettings";

/**
 * Show users what's new after an update (#2305), in the Site Settings card: the What's new card for
 * every user of this server. Hidden for an older backend that does not send the switch.
 */
export function WhatsNewSiteSetting() {
  const { t } = useTranslation();
  const { data: settings } = useGetSettingsQuery();
  const save = useSaveSiteSettings();
  const enabled = settings?.whats_new_enabled;
  if (enabled === undefined) {
    return null;
  }
  return (
    <Switch
      label={t("sitesettings.whatsnew")}
      description={t("sitesettings.whatsnew_description")}
      checked={enabled}
      onChange={() => save({ whats_new_enabled: !enabled })}
    />
  );
}
