import {
  Button,
  Card,
  Grid,
  Group,
  Modal,
  NativeSelect,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useGetSettingsQuery, useUpdateSettingsMutation } from "../../api_client/site-settings";

const MAX_HEAVYWEIGHT_PROCESSES = 10;
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
  { value: "blip_base_capfilt_large", label: "BLIP Base Capfilt Large" },
  { value: "none", label: "None" },
];

const LLM_MODELS = [
  { value: "mistral-7b-v0.1.Q5_K_M", label: "Mistral 7B v0.1 Q5 K M" },
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
  const [llmModel, setLlmModel] = useState("none");
  const [warning, setWarning] = useState("none");
  const { t } = useTranslation();
  const { data: settings, isLoading } = useGetSettingsQuery();
  const [saveSettings] = useUpdateSettingsMutation();
  const [opened, { open, close }] = useDisclosure(false);

  const saveSettingsWithValidation = (input: any) => {
    if (input.heavyweight_process && input.heavyweight_process > 3) {
      setWarning("heavyweight");
      open();
      return;
    }
    if (input.captioning_model === "blip_base_capfilt_large") {
      setWarning("blip");
      open();
      return;
    }
    saveSettings(input);
  };

  useEffect(() => {
    if (!isLoading && settings) {
      setSkipPatterns(settings.skip_patterns);
      setMapApiKey(settings.map_api_key);
      setMapApiProvider(settings.map_api_provider);
      setHeavyweightProcess(settings.heavyweight_process);
      setAllowRegistration(settings.allow_registration);
      setAllowUpload(settings.allow_upload);
      setCaptioningModel(settings.captioning_model);
      setLlmModel(settings.llm_model);
    }
  }, [settings, isLoading]);

  return (
    <div>
      <Modal
        opened={opened}
        onClose={() => {
          if (warning === "blip") {
            setCaptioningModel("im2txt");
            saveSettings({ captioning_model: "im2txt" });
          }
          if (warning === "heavyweight") {
            setHeavyweightProcess(3);
            saveSettings({ heavyweight_process: 3 });
          }
          close();
        }}
        title={<Title order={4}>{t("sitesettings.ram_warning_header")}</Title>}
      >
        <Stack>
          <Text>
            {warning === "blip" ? t("sitesettings.blip_warning") : t("sitesettings.heavyweight_process_warning")}
          </Text>
          <Group>
            <Button
              onClick={() => {
                if (warning === "blip") {
                  setCaptioningModel("im2txt");
                  saveSettings({ captioning_model: "im2txt" });
                }
                if (warning === "heavyweight") {
                  setHeavyweightProcess(3);
                  saveSettings({ heavyweight_process: 3 });
                }
                close();
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={() => {
                if (warning === "blip") {
                  saveSettings({ captioning_model: captioningModel });
                }
                if (warning === "heavyweight") {
                  saveSettings({ heavyweight_process: heavyweightProcess });
                }
                close();
              }}
              color="red"
            >
              {t("save")}
            </Button>
          </Group>
        </Stack>
      </Modal>

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
                onChange={model => {
                  const value = model ?? "";
                  saveSettingsWithValidation({ captioning_model: value });
                  setCaptioningModel(value);
                }}
              />
            </Grid.Col>
            <Grid.Col span={8}>
              <Stack spacing={0}>
                <Text>{t("sitesettings.llm_model_header")}</Text>
                <Text fz="sm" color="dimmed">
                  {t("sitesettings.llm_model_description")}
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={4}>
              <Select
                searchable
                withinPortal
                data={LLM_MODELS}
                dropdownPosition="bottom"
                value={llmModel}
                onChange={model => {
                  const value = model ?? "";
                  saveSettingsWithValidation({ llm_model: value });
                  setLlmModel(value);
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
                    saveSettingsWithValidation({ heavyweight_process: +e.currentTarget.value });
                  }
                }}
                onChange={e => {
                  if (/^([0-9\b]+)?$/.test(e.target.value)) {
                    setHeavyweightProcess(+e.currentTarget.value);
                    saveSettingsWithValidation({ heavyweight_process: +e.target.value });
                  }
                }}
              />
            </Grid.Col>
          </Grid>
        </Stack>
      </Card>
    </div>
  );
}
