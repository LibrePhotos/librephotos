import { NativeSelect, Stack, Switch, TextInput } from "@mantine/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useGetSettingsQuery, useUpdateSettingsMutation } from "../../api_client/site-settings";

const MAX_HEAVYWEIGHT_PROCESSES = 3;
const heavyweightProcessOptions = Array(MAX_HEAVYWEIGHT_PROCESSES)
  .fill("")
  .map((_, i) => (i + 1).toString());

export function SiteSettings() {
  const [skipPatterns, setSkipPatterns] = useState("");
  const [mapApiKey, setMapApiKey] = useState("");
  const [heavyweightProcess, setHeavyweightProcess] = useState(1);
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [allowUpload, setAllowUpload] = useState(false);
  const { t } = useTranslation();
  const { data: settings, isLoading } = useGetSettingsQuery();
  const [saveSettings] = useUpdateSettingsMutation();

  useEffect(() => {
    if (!isLoading && settings) {
      setSkipPatterns(settings.skip_patterns);
      setMapApiKey(settings.map_api_key);
      setHeavyweightProcess(settings.heavyweight_process);
      setAllowRegistration(settings.allow_registration);
      setAllowUpload(settings.allow_upload);
    }
  }, [settings, isLoading]);

  return (
    <Stack align="flex-start" justify="flex-start">
      <Switch
        label={t("sitesettings.header")}
        onChange={() => saveSettings({ allow_registration: !allowRegistration })}
        checked={allowRegistration}
      />
      <Switch
        label={t("sitesettings.headerupload")}
        onChange={() => saveSettings({ allow_upload: !allowUpload })}
        checked={allowUpload}
      />
      <TextInput
        style={{ maxWidth: 500 }}
        label={t("sitesettings.headerskippatterns")}
        description={t("sitesettings.skippatterns")}
        value={skipPatterns}
        onKeyDown={e => {
          if (e.key === "Enter") {
            saveSettings({ skip_patterns: skipPatterns });
          }
        }}
        onBlur={() => saveSettings({ skip_patterns: skipPatterns })}
        onChange={event => setSkipPatterns(event.currentTarget.value)}
      />
      <TextInput
        style={{ maxWidth: 500 }}
        label={t("sitesettings.headerapikey")}
        description={t("sitesettings.apikey")}
        rightSectionWidth={100}
        value={mapApiKey}
        onKeyDown={e => {
          if (e.key === "Enter") {
            saveSettings({ map_api_key: mapApiKey });
          }
        }}
        onBlur={() => saveSettings({ map_api_key: mapApiKey })}
        onChange={e => setMapApiKey(e.target.value)}
      />
      <NativeSelect
        style={{ maxWidth: 500 }}
        label={t("sitesettings.headerheavyweight")}
        description={t("sitesettings.heavyweight")}
        rightSectionWidth={100}
        data={heavyweightProcessOptions}
        value={heavyweightProcess}
        onKeyDown={e => {
          if (e.key === "Enter") {
            saveSettings({ heavyweight_process: +e.currentTarget.value });
          }
        }}
        onBlur={() => saveSettings({ heavyweight_process: heavyweightProcess })}
        onChange={e => {
          if (/^([0-9\b]+)?$/.test(e.target.value)) {
            setHeavyweightProcess(+e.currentTarget.value);
          }
        }}
      />
    </Stack>
  );
};
