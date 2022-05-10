import { NativeSelect, SimpleGrid, Switch, TextInput } from "@mantine/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "semantic-ui-react";

import { setSiteSettings } from "../../actions/utilActions";
import { useAppDispatch, useAppSelector } from "../../store/store";

export const SiteSettings = () => {
  const [skip_patterns, setSkipPatterns] = useState([]);
  const [map_api_key, setMapApiKey] = useState("");
  const [heavyweight_process, setHeavyweigthProcess] = useState(1);

  const siteSettings = useAppSelector(state => state.util.siteSettings);

  useEffect(() => {
    setSkipPatterns(siteSettings.skip_patterns);
    setMapApiKey(siteSettings.map_api_key);
    setHeavyweigthProcess(siteSettings.heavyweight_process);
  }, [siteSettings]);

  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  const options = ["1", "2", "3"];

  return (
    <SimpleGrid cols={2} spacing="lg">
      <b>{t("sitesettings.header")}</b>
      <Switch
        label={t("sitesettings.allow")}
        onChange={() => dispatch(setSiteSettings({ allow_registration: !siteSettings.allow_registration }))}
        checked={siteSettings.allow_registration}
      ></Switch>
      <b>{t("sitesettings.headerupload")}</b>
      <Switch
        label={t("sitesettings.allow")}
        onChange={() => dispatch(setSiteSettings({ allow_upload: !siteSettings.allow_upload }))}
        checked={siteSettings.allow_upload}
      ></Switch>
      <b>{t("sitesettings.headerskippatterns")}</b>
      <TextInput
        label={t("sitesettings.skippatterns")}
        value={skip_patterns}
        onKeyDown={e => {
          if (e.key === "Enter") {
            dispatch(setSiteSettings({ skip_patterns: skip_patterns }));
          }
        }}
        onBlur={() => dispatch(setSiteSettings({ skip_patterns: skip_patterns }))}
        //@ts-ignore
        onChange={event => setSkipPatterns(event.currentTarget.value)}
      />
      <b>{t("sitesettings.headerapikey")}</b>
      <TextInput
        label={t("sitesettings.apikey")}
        value={map_api_key}
        onKeyDown={e => {
          if (e.key === "Enter") {
            dispatch(setSiteSettings({ map_api_key: map_api_key }));
          }
        }}
        onBlur={() => dispatch(setSiteSettings({ map_api_key: map_api_key }))}
        onChange={e => setMapApiKey(e.target.value)}
      />
      <b>{t("sitesettings.headerheavyweight")}</b>
      <NativeSelect
        label={t("sitesettings.heavyweight")}
        data={options}
        value={heavyweight_process}
        onKeyDown={e => {
          if (e.key === "Enter") {
            dispatch(setSiteSettings({ heavyweight_process: e.currentTarget.value }));
          }
        }}
        onBlur={() => dispatch(setSiteSettings({ heavyweight_process: heavyweight_process }))}
        onChange={e => {
          const re = /^[0-9\b]+$/;

          // if value is not blank, then test the regex
          if (e.target.value === "" || re.test(e.target.value)) {
            //@ts-ignore
            setHeavyweigthProcess(e.currentTarget.value);
          }
        }}
      />
    </SimpleGrid>
  );
};
