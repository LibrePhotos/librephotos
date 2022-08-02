import { NativeSelect, Stack, Switch, TextInput } from "@mantine/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { setSiteSettings } from "../../actions/utilActions";
import { useAppDispatch, useAppSelector } from "../../store/store";

export const SiteSettings = () => {
  const [skipPatterns, setSkipPatterns] = useState("");
  const [mapApiKey, setMapApiKey] = useState("");
  const [heavyweightProcess, setHeavyweightProcess] = useState(1);
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [allowUpload, setAllowUpload] = useState(false);
  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  const siteSettings = useAppSelector(state => state.util.siteSettings);

  useEffect(() => {
    setSkipPatterns(siteSettings.skip_patterns);
    setMapApiKey(siteSettings.map_api_key);
    setHeavyweightProcess(siteSettings.heavyweight_process);
    setAllowRegistration(siteSettings.allow_registration);
    setAllowUpload(siteSettings.allow_upload);
  }, [siteSettings]);


  const options = ["1", "2", "3"];

  return (
    <Stack align="flex-start" justify="flex-start">
      <Switch
        label={t("sitesettings.header")}
        onChange={() => dispatch(setSiteSettings({ allow_registration: !siteSettings.allow_registration }))}
        checked={allowRegistration}
      />
      <Switch
        label={t("sitesettings.headerupload")}
        onChange={() => dispatch(setSiteSettings({ allow_upload: !siteSettings.allow_upload }))}
        checked={allowUpload}
      />
      <TextInput
        style={{ maxWidth: 500 }}
        label={t("sitesettings.headerskippatterns")}
        description={t("sitesettings.skippatterns")}
        value={skipPatterns}
        onKeyDown={e => {
          if (e.key === "Enter") {
            dispatch(setSiteSettings({ skip_patterns: skipPatterns }));
          }
        }}
        onBlur={() => dispatch(setSiteSettings({ skip_patterns: skipPatterns }))}
        // @ts-ignore
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
            dispatch(setSiteSettings({ map_api_key: mapApiKey }));
          }
        }}
        onBlur={() => dispatch(setSiteSettings({ map_api_key: mapApiKey }))}
        onChange={e => setMapApiKey(e.target.value)}
      />
      <NativeSelect
        style={{ maxWidth: 500 }}
        label={t("sitesettings.headerheavyweight")}
        description={t("sitesettings.heavyweight")}
        rightSectionWidth={100}
        data={options}
        value={heavyweightProcess}
        onKeyDown={e => {
          if (e.key === "Enter") {
            dispatch(setSiteSettings({ heavyweight_process: e.currentTarget.value }));
          }
        }}
        onBlur={() => {
          if (heavyweightProcess !== siteSettings.heavyweight_process) {
            dispatch(setSiteSettings({ heavyweight_process: heavyweightProcess }));
          }
        }}
        onChange={e => {
          const re = /^[0-9\b]+$/;

          // if value is not blank, then test the regex
          if (e.target.value === "" || re.test(e.target.value)) {
            // @ts-ignore
            setHeavyweightProcess(e.currentTarget.value);
          }
        }}
      />
    </Stack>
  );
};
