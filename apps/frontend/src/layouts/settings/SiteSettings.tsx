import { Card, Grid, NativeSelect, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
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
    <Card shadow="md" mb={10}>
      <Stack>
        <Title order={4} sx={{ marginBottom: 16 }}>
          {t("adminarea.sitesettings")}
        </Title>

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

        <Grid align="flex-end">
          <Grid.Col span={8}>
            <Stack spacing={0}>
              <Text>{t("sitesettings.headerskippatterns")}</Text>
              <Text fz="sm" color="dimmed">
                {t("sitesettings.skippatterns")}
              </Text>
            </Stack>
          </Grid.Col>
          <Grid.Col span={4}>
            <TextInput
              value={skipPatterns}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  saveSettings({ skip_patterns: skipPatterns });
                }
              }}
              onBlur={() => saveSettings({ skip_patterns: skipPatterns })}
              onChange={event => setSkipPatterns(event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={8}>
            <Stack spacing={0}>
              <Text>{t("sitesettings.headerapikey")}</Text>
              <Text fz="sm" color="dimmed">
                {t("sitesettings.apikey")}
              </Text>
            </Stack>
          </Grid.Col>
          <Grid.Col span={4}>
            <TextInput
              value={mapApiKey}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  saveSettings({ map_api_key: mapApiKey });
                }
              }}
              onBlur={() => saveSettings({ map_api_key: mapApiKey })}
              onChange={e => setMapApiKey(e.target.value)}
            />
          </Grid.Col>
          <Grid.Col span={8}>
            <Stack spacing={0}>
              <Text>{t("sitesettings.headerheavyweight")}</Text>
              <Text fz="sm" color="dimmed">
                {t("sitesettings.heavyweight")}
              </Text>
            </Stack>
          </Grid.Col>
          <Grid.Col span={4}>
            <NativeSelect
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
          </Grid.Col>
        </Grid>
      </Stack>
    </Card>
  );
}
