import { Button, Card, Grid, Group, Modal, Select, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { showNotification } from "@mantine/notifications";
import type { TFunction } from "i18next";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetSettingsQuery, useUpdateSettingsMutation } from "../../api_client/settings/hooks";
import type { SiteSettings as SiteSettingsType } from "../../api_client/settings/types";
import { EmailSettings } from "./EmailSettings";

/** What an option's label says about it, after the product name; translated at render time. */
type OptionHint = "default" | "fast_default" | "lightweight_default" | "fastest" | "most_accurate";

type ModelOption = { value: string; label: string; hint?: OptionHint };

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

const MAP_TILE_PROVIDERS: ModelOption[] = [
  { value: "photoprism", label: "PhotoPrism", hint: "default" },
  { value: "osm", label: "OpenStreetMap" },
  { value: "none", label: "" },
];

const CAPTIONING_MODELS: ModelOption[] = [
  { value: "lfm2_vl_450m", label: "LFM2.5-VL", hint: "default" },
  { value: "none", label: "" },
];

const DEFAULT_CAPTIONING_MODEL = "lfm2_vl_450m";
const DEFAULT_TAGGING_MODEL = "mobileclip_s2";

const TAGGING_MODELS: ModelOption[] = [
  { value: "mobileclip_s2", label: "MobileCLIP-S2", hint: "fast_default" },
  { value: "siglip2", label: "SigLIP 2", hint: "most_accurate" },
];

const OCR_MODELS: ModelOption[] = [
  { value: "none", label: "" },
  { value: "ppocrv6_tiny", label: "PP-OCRv6 Tiny", hint: "fastest" },
  { value: "ppocrv6_small", label: "PP-OCRv6 Small" },
  { value: "ppocrv6_medium", label: "PP-OCRv6 Medium", hint: "most_accurate" },
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

const FACE_RECOGNITION_MODELS: ModelOption[] = [
  { value: "buffalo_sc", label: "buffalo_sc", hint: "lightweight_default" },
  { value: "buffalo_s", label: "buffalo_s" },
  { value: "buffalo_m", label: "buffalo_m" },
  { value: "buffalo_l", label: "buffalo_l", hint: "most_accurate" },
  { value: "antelopev2", label: "antelopev2" },
];

/** Product names stay as they are; "None" and the hints after a name are translated. */
function translateOptions(options: ModelOption[], t: TFunction<"translation", undefined>, noneLabel: string) {
  return options.map(({ value, label, hint }) => {
    if (value === "none") {
      return { value, label: noneLabel };
    }
    return { value, label: hint ? t(`sitesettings.option_${hint}`, { name: label }) : label };
  });
}

// Label and control side by side from the sm breakpoint up, stacked on a phone.
const LABEL_SPAN = { base: 12, sm: 8 };
const CONTROL_SPAN = { base: 12, sm: 4 };

export function SiteSettings() {
  const [skipPatterns, setSkipPatterns] = useState("");
  const [mapApiKey, setMapApiKey] = useState("");
  const [mapApiProvider, setMapApiProvider] = useState<string>("nominatim");
  const [mapTileProvider, setMapTileProvider] = useState<string>("photoprism");
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [allowUpload, setAllowUpload] = useState(false);
  const [nextcloudEnabled, setNextcloudEnabled] = useState(false);
  const [autoCreateUserDirectory, setAutoCreateUserDirectory] = useState(false);
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

  // Site settings apply as soon as they change, so confirm each save. The fixed id keeps a
  // quick run of toggles from stacking up toasts.
  const save = (input: Partial<SiteSettingsType>) => {
    saveSettings(input, {
      onSuccess: () =>
        showNotification({
          id: "site-settings-saved",
          message: t("sitesettings.saved"),
          color: "teal",
          autoClose: 1500,
        }),
    });
  };

  // The text fields save on blur and on Enter; only send what actually changed.
  const saveSkipPatterns = () => {
    if (settings && skipPatterns !== settings.skip_patterns) {
      save({ skip_patterns: skipPatterns });
    }
  };

  const saveMapApiKey = () => {
    if (settings && mapApiKey !== settings.map_api_key) {
      save({ map_api_key: mapApiKey });
    }
  };

  const dismissWarning = () => {
    if (warning === "ocr") {
      setOcrModel(previousOcrModel);
    }
    close();
  };

  const confirmWarning = () => {
    if (warning === "ocr") {
      save({ ocr_model: ocrModel });
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
      setAutoCreateUserDirectory(settings.auto_create_user_directory ?? false);
      setCaptioningModel(settings.captioning_model);
      setTaggingModel(settings.tagging_model);
      setOcrModel(normalizeOcrModel(settings.ocr_model));
      setPreviousOcrModel(normalizeOcrModel(settings.ocr_model));
      setFaceRecognitionModel(settings.face_recognition_model);
    }
  }, [settings, isLoading]);

  // A fragment, so the cards are direct children of the admin page's Stack and get its gap.
  return (
    <>
      <Modal
        opened={opened}
        onClose={dismissWarning}
        // Plain text: the title is already an h2, and the app theme styles it like every other dialog.
        title={warning === "ocr" ? t("sitesettings.ocr_warning_header") : t("sitesettings.ram_warning_header")}
      >
        <Stack>
          <Text>
            {warning === "ocr" ? t("sitesettings.ocr_warning") : t("sitesettings.heavyweight_process_warning")}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={dismissWarning}>
              {t("cancel")}
            </Button>
            <Button onClick={confirmWarning} color="red">
              {t("save")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Card shadow="md">
        <Stack>
          <Title order={4}>{t("adminarea.sitesettings")}</Title>

          <Switch
            label={t("sitesettings.header")}
            onChange={() => save({ allow_registration: !allowRegistration })}
            checked={allowRegistration}
          />
          <Switch
            label={t("sitesettings.headerupload")}
            onChange={() => save({ allow_upload: !allowUpload })}
            checked={allowUpload}
          />
          <Switch
            label={t("sitesettings.headernextcloud")}
            onChange={() => save({ nextcloud_enabled: !nextcloudEnabled })}
            checked={nextcloudEnabled}
          />
          <Switch
            label={t("sitesettings.headerautocreateuserdirectory")}
            description={t("sitesettings.autocreateuserdirectory")}
            onChange={() => save({ auto_create_user_directory: !autoCreateUserDirectory })}
            checked={autoCreateUserDirectory}
          />

          <Grid justify="flex-end">
            <Grid.Col span={LABEL_SPAN}>
              <Stack gap={0}>
                <Text>{t("sitesettings.headerskippatterns")}</Text>
                <Text fz="sm" c="dimmed">
                  {t("sitesettings.skippatterns")}
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={CONTROL_SPAN}>
              <TextInput
                value={skipPatterns}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    saveSkipPatterns();
                  }
                }}
                onBlur={saveSkipPatterns}
                onChange={event => setSkipPatterns(event.currentTarget.value)}
              />
            </Grid.Col>
            <Grid.Col span={LABEL_SPAN}>
              <Stack gap={0}>
                <Text>{t("sitesettings.map_api_provider_header")}</Text>
                <Text fz="sm" c="dimmed">
                  {t("sitesettings.map_api_provider_description", {
                    url: MAP_API_PROVIDERS.find(provider => provider.value === mapApiProvider)?.data.url,
                  })}
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={CONTROL_SPAN}>
              {/* allowDeselect: clicking the selected option again would otherwise save an
                  empty value, which silently breaks reverse geocoding (or unsets the model). */}
              <Select
                searchable
                allowDeselect={false}
                data={MAP_API_PROVIDERS}
                value={mapApiProvider}
                onChange={provider => {
                  if (!provider) return;
                  setMapApiProvider(provider);
                  save({ map_api_provider: provider });
                }}
              />
            </Grid.Col>
            {MAP_API_PROVIDERS.find(provider => provider.value === mapApiProvider)?.data.use_api_key && (
              <>
                <Grid.Col span={LABEL_SPAN}>
                  <Stack gap={0}>
                    <Text>{t("sitesettings.map_api_key_header")}</Text>
                    <Text fz="sm" c="dimmed">
                      {t("sitesettings.map_api_key_description", {
                        url: MAP_API_PROVIDERS.find(provider => provider.value === mapApiProvider)?.data.url,
                      })}
                    </Text>
                  </Stack>
                </Grid.Col>
                <Grid.Col span={CONTROL_SPAN}>
                  <TextInput
                    value={mapApiKey}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        saveMapApiKey();
                      }
                    }}
                    onBlur={saveMapApiKey}
                    onChange={e => setMapApiKey(e.target.value)}
                  />
                </Grid.Col>
              </>
            )}
            <Grid.Col span={LABEL_SPAN}>
              <Stack gap={0}>
                <Text>{t("sitesettings.map_tile_provider_header")}</Text>
                <Text fz="sm" c="dimmed">
                  {t("sitesettings.map_tile_provider_description")}
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={CONTROL_SPAN}>
              <Select
                allowDeselect={false}
                data={translateOptions(MAP_TILE_PROVIDERS, t, t("sitesettings.maptile_none"))}
                value={mapTileProvider}
                onChange={provider => {
                  const value = provider || "photoprism";
                  setMapTileProvider(value);
                  save({ map_tile_provider: value });
                }}
              />
            </Grid.Col>
            <Grid.Col span={LABEL_SPAN}>
              <Stack gap={0}>
                <Text>{t("sitesettings.captioning_model_header")}</Text>
                <Text fz="sm" c="dimmed">
                  {t("sitesettings.captioning_model_description")}
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={CONTROL_SPAN}>
              <Select
                searchable
                allowDeselect={false}
                data={translateOptions(CAPTIONING_MODELS, t, t("sitesettings.model_none"))}
                value={captioningModel}
                onChange={model => {
                  if (!model) return;
                  save({ captioning_model: model });
                  setCaptioningModel(model);
                }}
              />
            </Grid.Col>
            <Grid.Col span={LABEL_SPAN}>
              <Stack gap={0}>
                <Text>{t("sitesettings.tagging_model_header")}</Text>
                <Text fz="sm" c="dimmed">
                  {t("sitesettings.tagging_model_description")}
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={CONTROL_SPAN}>
              <Select
                searchable
                allowDeselect={false}
                data={translateOptions(TAGGING_MODELS, t, t("sitesettings.model_none"))}
                value={taggingModel}
                onChange={model => {
                  const value = model ?? DEFAULT_TAGGING_MODEL;
                  save({ tagging_model: value });
                  setTaggingModel(value);
                }}
              />
            </Grid.Col>
            <Grid.Col span={LABEL_SPAN}>
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
            <Grid.Col span={CONTROL_SPAN}>
              <Select
                searchable
                allowDeselect={false}
                data={translateOptions(OCR_MODELS, t, t("sitesettings.model_none"))}
                value={ocrModel}
                onChange={model => {
                  const value = normalizeOcrModel(model);
                  setOcrModel(value);
                  if (value === OCR_DISABLED) {
                    setPreviousOcrModel(value);
                    save({ ocr_model: value });
                    return;
                  }
                  // Turning OCR on has privacy consequences, so let the admin confirm first.
                  setWarning("ocr");
                  open();
                }}
              />
            </Grid.Col>
            <Grid.Col span={LABEL_SPAN}>
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
            <Grid.Col span={CONTROL_SPAN}>
              <Select
                searchable
                allowDeselect={false}
                data={translateOptions(FACE_RECOGNITION_MODELS, t, t("sitesettings.model_none"))}
                value={faceRecognitionModel}
                onChange={model => {
                  const value = model ?? "buffalo_sc";
                  save({ face_recognition_model: value });
                  setFaceRecognitionModel(value);
                }}
              />
            </Grid.Col>
          </Grid>
        </Stack>
      </Card>

      <EmailSettings />
    </>
  );
}
