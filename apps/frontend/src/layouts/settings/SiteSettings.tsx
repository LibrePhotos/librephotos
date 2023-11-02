import { Card, Grid, NativeSelect, Select, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useGetSettingsQuery, useUpdateSettingsMutation } from "../../api_client/site-settings";

const MAX_HEAVYWEIGHT_PROCESSES = 3;
const heavyweightProcessOptions = Array(MAX_HEAVYWEIGHT_PROCESSES)
  .fill("")
  .map((_, i) => (i + 1).toString());

const MAP_API_PROVIDERS = [
  { value: "mapbox", label: "Mapbox", data: { use_api_key: true, url: "https://www.mapbox.com/" } },
  { value: "maptiler", label: "MapTiler", data: { use_api_key: true, url: "https://www.maptiler.com/" } },
  {
    value: "nominatim",
    label: "Nominatim (OpenStreetMap)",
    data: { use_api_key: false, url: "https://nominatim.org/" },
  },
  { value: "opencage", label: "OpenCage", data: { use_api_key: true, url: "https://opencagedata.com/" } },
  { value: "photon", label: "Photon", data: { use_api_key: false, url: "https://photon.komoot.io/" } },
  { value: "tomtom", label: "TomTom", data: { use_api_key: true, url: "https://www.tomtom.com/" } },
];

const CAPTIONING_MODELS = [
  { value: "im2txt", label: "im2txt PyTorch" },
  { value: "im2txt_onnx", label: "im2txt ONNX" },
  { value: "none", label: "None" },
];

export function SiteSettings() {
  const [skipPatterns, setSkipPatterns] = useState("");
  const [mapApiKey, setMapApiKey] = useState("");
  const [mapApiProvider, setMapApiProvider] = useState<string>("proton");
  const [heavyweightProcess, setHeavyweightProcess] = useState(1);
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [allowUpload, setAllowUpload] = useState(false);
  const [captioningModel, setCaptioningModel] = useState("im2txt");
  const { t } = useTranslation();
  const { data: settings, isLoading } = useGetSettingsQuery();
  const [saveSettings] = useUpdateSettingsMutation();

  useEffect(() => {
    if (!isLoading && settings) {
      setSkipPatterns(settings.skip_patterns);
      setMapApiKey(settings.map_api_key);
      setMapApiProvider(settings.map_api_provider);
      setHeavyweightProcess(settings.heavyweight_process);
      setAllowRegistration(settings.allow_registration);
      setAllowUpload(settings.allow_upload);
      setCaptioningModel(settings.captioning_model);
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
              <Text>{t("sitesettings.map_api_provider_header")}</Text>
              <Text fz="sm" color="dimmed">
                {t("sitesettings.map_api_provider_description", {
                  url: MAP_API_PROVIDERS.find(provider => provider.value === mapApiProvider)?.data.url,
                })}
              </Text>
            </Stack>
          </Grid.Col>
          <Grid.Col span={4}>
            <Select
              searchable
              withinPortal
              data={MAP_API_PROVIDERS}
              dropdownPosition="bottom"
              value={mapApiProvider}
              onChange={provider => {
                const value = provider || "";
                setMapApiProvider(value);
                saveSettings({ map_api_provider: value });
              }}
            />
          </Grid.Col>
          {MAP_API_PROVIDERS.find(provider => provider.value === mapApiProvider)?.data.use_api_key && (
            <>
              <Grid.Col span={8}>
                <Stack spacing={0}>
                  <Text>{t("sitesettings.map_api_key_header")}</Text>
                  <Text fz="sm" color="dimmed">
                    {t("sitesettings.map_api_key_description", {
                      url: MAP_API_PROVIDERS.find(provider => provider.value === mapApiProvider)?.data.url,
                    })}
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
            </>
          )}
          <Grid.Col span={8}>
            <Stack spacing={0}>
              <Text>{t("sitesettings.captioning_model_header")}</Text>
              <Text fz="sm" color="dimmed">
                {t("sitesettings.captioning_model_description")}
              </Text>
            </Stack>
          </Grid.Col>
          <Grid.Col span={4}>
            <Select
              searchable
              withinPortal
              data={CAPTIONING_MODELS}
              dropdownPosition="bottom"
              value={captioningModel}
              onChange={captioningModel => {
                const value = captioningModel || "";
                setCaptioningModel(value);
                saveSettings({ captioning_model: value });
              }}
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
