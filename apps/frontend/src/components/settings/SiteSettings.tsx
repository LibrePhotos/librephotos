import { Button, Card, Grid, Group, Modal, Select, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetSettingsQuery, useUpdateSettingsMutation } from "../../api_client/settings/hooks";
import { EmailSettings } from "./EmailSettings";

const MAP_API_PROVIDERS = [
  {
    value: "nominatim",
    label: "Nominatim (OpenStreetMap)",
    data: { use_api_key: false, url: "https://nominatim.org/" },
  },
  { value: "mapbox", label: "Mapbox", data: { use_api_key: true, url: "https://www.mapbox.com/" } },
  { value: "maptiler", label: "MapTiler", data: { use_api_key: true, url: "https://www.maptiler.com/" } },
  { value: "opencage", label: "OpenCage", data: { use_api_key: true, url: "https://opencagedata.com/" } },
  { value: "tomtom", label: "TomTom", data: { use_api_key: true, url: "https://www.tomtom.com/" } },
];

const MAP_TILE_PROVIDERS = [
  { value: "photoprism", label: "PhotoPrism (default)" },
  { value: "osm", label: "OpenStreetMap" },
  { value: "none", label: "None (hide map)" },
];

const CAPTIONING_MODELS = [
  { value: "lfm2_vl_450m", label: "LFM2.5-VL (default)" },
  { value: "none", label: "None" },
];

const DEFAULT_CAPTIONING_MODEL = "lfm2_vl_450m";
const DEFAULT_TAGGING_MODEL = "mobileclip_s2";

const TAGGING_MODELS = [
  { value: "mobileclip_s2", label: "MobileCLIP-S2 (fast, default)" },
  { value: "siglip2", label: "SigLIP 2 (most accurate)" },
];

const OCR_MODELS = [
  { value: "none", label: "None" },
  { value: "ppocrv6_tiny", label: "PP-OCRv6 Tiny (fastest)" },
  { value: "ppocrv6_small", label: "PP-OCRv6 Small" },
  { value: "ppocrv6_medium", label: "PP-OCRv6 Medium (most accurate)" },
];

const OCR_DISABLED = "none";

/**
 * The backend ships "None" as the default and treats the value case insensitively, so map
 * anything that means "off" onto the single lowercase value the Select knows about. Without
 * this the Select would render empty for a server that never had OCR configured.
 */
function normalizeOcrModel(model: string | null | undefined) {
  if (!model || model.trim().toLowerCase() === OCR_DISABLED) {
    return OCR_DISABLED;
  }
  return model;
}

const FACE_RECOGNITION_MODELS = [
  { value: "buffalo_sc", label: "buffalo_sc (lightweight, default)" },
  { value: "buffalo_s", label: "buffalo_s" },
  { value: "buffalo_m", label: "buffalo_m" },
  { value: "buffalo_l", label: "buffalo_l (most accurate)" },
  { value: "antelopev2", label: "antelopev2" },
];

export function SiteSettings() {
  const [skipPatterns, setSkipPatterns] = useState("");
  const [mapApiKey, setMapApiKey] = useState("");
  const [mapApiProvider, setMapApiProvider] = useState<string>("nominatim");
  const [mapTileProvider, setMapTileProvider] = useState<string>("photoprism");
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [allowUpload, setAllowUpload] = useState(false);
  const [nextcloudEnabled, setNextcloudEnabled] = useState(false);
  const [captioningModel, setCaptioningModel] = useState(DEFAULT_CAPTIONING_MODEL);
  const [taggingModel, setTaggingModel] = useState(DEFAULT_TAGGING_MODEL);
  const [ocrModel, setOcrModel] = useState(OCR_DISABLED);
  // Restored when the user backs out of the OCR confirmation dialog.
  const [previousOcrModel, setPreviousOcrModel] = useState(OCR_DISABLED);
  const [faceRecognitionModel, setFaceRecognitionModel] = useState("buffalo_sc");
  const [warning, setWarning] = useState("none");
  const { t } = useTranslation();
  const { data: settings, isLoading } = useGetSettingsQuery();
  const { mutate: saveSettings } = useUpdateSettingsMutation();
  const [opened, { open, close }] = useDisclosure(false);

  const saveSettingsWithValidation = (input: any) => {
    saveSettings(input);
  };

  const dismissWarning = () => {
    if (warning === "ocr") {
      setOcrModel(previousOcrModel);
    }
    close();
  };

  const confirmWarning = () => {
    if (warning === "ocr") {
      saveSettings({ ocr_model: ocrModel });
      setPreviousOcrModel(ocrModel);
    }
    close();
  };

  useEffect(() => {
    if (!isLoading && settings) {
      setSkipPatterns(settings.skip_patterns);
      setMapApiKey(settings.map_api_key);
      setMapApiProvider(settings.map_api_provider);
      setMapTileProvider(settings.map_tile_provider);
      setAllowRegistration(settings.allow_registration);
      setAllowUpload(settings.allow_upload);
      setNextcloudEnabled(settings.nextcloud_enabled);
      setCaptioningModel(settings.captioning_model);
      setTaggingModel(settings.tagging_model);
      setOcrModel(normalizeOcrModel(settings.ocr_model));
      setPreviousOcrModel(normalizeOcrModel(settings.ocr_model));
      setFaceRecognitionModel(settings.face_recognition_model);
    }
  }, [settings, isLoading]);

  return (
    <div>
      <Modal
        opened={opened}
        onClose={dismissWarning}
        title={
          <Title order={4}>
            {warning === "ocr" ? t("sitesettings.ocr_warning_header") : t("sitesettings.ram_warning_header")}
          </Title>
        }
      >
        <Stack>
          <Text>
            {warning === "ocr" ? t("sitesettings.ocr_warning") : t("sitesettings.heavyweight_process_warning")}
          </Text>
          <Group>
            <Button onClick={dismissWarning}>{t("cancel")}</Button>
            <Button onClick={confirmWarning} color="red">
              {t("save")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Card shadow="md" mb={10}>
        <Stack>
          <Title order={4} mb={16}>
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
          <Switch
            label={t("sitesettings.headernextcloud")}
            onChange={() => saveSettings({ nextcloud_enabled: !nextcloudEnabled })}
            checked={nextcloudEnabled}
          />

          <Grid justify="flex-end">
            <Grid.Col span={8}>
              <Stack gap={0}>
                <Text>{t("sitesettings.headerskippatterns")}</Text>
                <Text fz="sm" c="dimmed">
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
              <Stack gap={0}>
                <Text>{t("sitesettings.map_api_provider_header")}</Text>
                <Text fz="sm" c="dimmed">
                  {t("sitesettings.map_api_provider_description", {
                    url: MAP_API_PROVIDERS.find(provider => provider.value === mapApiProvider)?.data.url,
                  })}
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={4}>
              <Select
                searchable
                data={MAP_API_PROVIDERS}
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
                  <Stack gap={0}>
                    <Text>{t("sitesettings.map_api_key_header")}</Text>
                    <Text fz="sm" c="dimmed">
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
              <Stack gap={0}>
                <Text>{t("sitesettings.map_tile_provider_header")}</Text>
                <Text fz="sm" c="dimmed">
                  {t("sitesettings.map_tile_provider_description")}
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={4}>
              <Select
                data={MAP_TILE_PROVIDERS}
                value={mapTileProvider}
                onChange={provider => {
                  const value = provider || "photoprism";
                  setMapTileProvider(value);
                  saveSettings({ map_tile_provider: value });
                }}
              />
            </Grid.Col>
            <Grid.Col span={8}>
              <Stack gap={0}>
                <Text>{t("sitesettings.captioning_model_header")}</Text>
                <Text fz="sm" c="dimmed">
                  {t("sitesettings.captioning_model_description")}
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={4}>
              <Select
                searchable
                data={CAPTIONING_MODELS}
                value={captioningModel}
                onChange={model => {
                  const value = model ?? "";
                  saveSettingsWithValidation({ captioning_model: value });
                  setCaptioningModel(value);
                }}
              />
            </Grid.Col>
            <Grid.Col span={8}>
              <Stack gap={0}>
                <Text>{t("sitesettings.tagging_model_header", "Tagging Model")}</Text>
                <Text fz="sm" c="dimmed">
                  {t(
                    "sitesettings.tagging_model_description",
                    "Select the model used for auto-tagging photos. Switching models does not delete previously generated tags."
                  )}
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={4}>
              <Select
                searchable
                data={TAGGING_MODELS}
                value={taggingModel}
                onChange={model => {
                  const value = model ?? DEFAULT_TAGGING_MODEL;
                  saveSettings({ tagging_model: value });
                  setTaggingModel(value);
                }}
              />
            </Grid.Col>
            <Grid.Col span={8}>
              <Stack gap={0}>
                <Text>{t("sitesettings.ocr_model_header", "Text Recognition (OCR) Model")}</Text>
                <Text fz="sm" c="dimmed">
                  {t(
                    "sitesettings.ocr_model_description",
                    'Extracts readable text from your photos into the database so that it becomes searchable. This includes text on documents, receipts and IDs. Choose "None" to keep OCR off.'
                  )}
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={4}>
              <Select
                searchable
                data={OCR_MODELS}
                value={ocrModel}
                onChange={model => {
                  const value = normalizeOcrModel(model);
                  setOcrModel(value);
                  if (value === OCR_DISABLED) {
                    setPreviousOcrModel(value);
                    saveSettings({ ocr_model: value });
                    return;
                  }
                  // Turning OCR on has privacy consequences, so let the admin confirm first.
                  setWarning("ocr");
                  open();
                }}
              />
            </Grid.Col>
            <Grid.Col span={8}>
              <Stack gap={0}>
                <Text>{t("sitesettings.face_recognition_model_header", "Face Recognition Model")}</Text>
                <Text fz="sm" c="dimmed">
                  {t(
                    "sitesettings.face_recognition_model_description",
                    "Select the InsightFace model pack used for face recognition. Larger models are more accurate but require more resources."
                  )}
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={4}>
              <Select
                searchable
                data={FACE_RECOGNITION_MODELS}
                value={faceRecognitionModel}
                onChange={model => {
                  const value = model ?? "buffalo_sc";
                  saveSettings({ face_recognition_model: value });
                  setFaceRecognitionModel(value);
                }}
              />
            </Grid.Col>
          </Grid>
        </Stack>
      </Card>

      <EmailSettings />
    </div>
  );
}
