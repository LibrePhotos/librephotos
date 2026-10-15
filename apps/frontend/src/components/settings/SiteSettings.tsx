import { Button, Card, Grid, Group, Modal, Select, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import type { TFunction } from "i18next";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { AutoScanSetting } from "./AutoScanSetting";
import { CONTROL_SPAN, LABEL_SPAN, MissingPhotosLimitSetting, SkipPatternsSetting } from "./ScanSettings";
import { SectionLink } from "./SettingsSection";
import { TrashRetentionSetting } from "./TrashRetentionSetting";
import { useSaveSiteSettings } from "./useSaveSiteSettings";

/** What an option's label says about it, after the product name; translated at render time. */
type OptionHint = "default" | "lightweight_default" | "fastest" | "most_accurate" | "offline";

type ModelOption = { value: string; label: string; hint?: OptionHint };

type MapApiProvider = ModelOption & { data: { use_api_key: boolean; url: string } };

const MAP_API_PROVIDERS: MapApiProvider[] = [
  // ExifTool's own Geolocation database (#2302): no network, no API key.
  {
    value: "exiftool",
    label: "ExifTool",
    hint: "offline",
    data: { use_api_key: false, url: "https://exiftool.org/geolocation.html" },
  },
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

/**
 * The site settings card. Its controls appear only once the settings are loaded: each switch
 * saves the opposite of what it shows, so a click before then saved the wrong value, and a
 * failed request showed every switch "off" whatever the server had (#2224).
 */
export function SiteSettings() {
  const { t } = useTranslation();
  const settingsQuery = useGetSettingsQuery();
  const failure = useListFailure(settingsQuery);

  if (settingsQuery.data) {
    return <SiteSettingsForm />;
  }
  return (
    <Card shadow="md">
      <Title order={4}>
        {t("adminarea.sitesettings")}
        <SectionLink />
      </Title>
      {failure ? <ErrorState failure={failure} compact /> : <PageLoader />}
    </Card>
  );
}

function SiteSettingsForm() {
  const [mapApiKey, setMapApiKey] = useState("");
  const [mapApiProvider, setMapApiProvider] = useState<string>("exiftool");
  const [mapTileProvider, setMapTileProvider] = useState<string>("photoprism");
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [allowUpload, setAllowUpload] = useState(false);
  const [nextcloudEnabled, setNextcloudEnabled] = useState(false);
  const [autoCreateUserDirectory, setAutoCreateUserDirectory] = useState(false);
  const [captioningModel, setCaptioningModel] = useState(DEFAULT_CAPTIONING_MODEL);
  const [ocrModel, setOcrModel] = useState(OCR_DISABLED);
  // Restored when the user backs out of the OCR confirmation dialog.
  const [previousOcrModel, setPreviousOcrModel] = useState(OCR_DISABLED);
  const [faceRecognitionModel, setFaceRecognitionModel] = useState("buffalo_sc");
  const [warning, setWarning] = useState("none");
  const { t } = useTranslation();
  const { data: settings, isLoading, dataUpdatedAt } = useGetSettingsQuery();
  const save = useSaveSiteSettings();
  const [opened, { open, close }] = useDisclosure(false);

  // The text fields save on blur and on Enter; only send what actually changed.
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
      setMapApiKey(settings.map_api_key);
      setMapApiProvider(settings.map_api_provider);
      setMapTileProvider(settings.map_tile_provider);
      setAllowRegistration(settings.allow_registration);
      setAllowUpload(settings.allow_upload);
      setNextcloudEnabled(settings.nextcloud_enabled);
      setAutoCreateUserDirectory(settings.auto_create_user_directory ?? false);
      setCaptioningModel(settings.captioning_model);
      setOcrModel(normalizeOcrModel(settings.ocr_model));
      setPreviousOcrModel(normalizeOcrModel(settings.ocr_model));
      setFaceRecognitionModel(settings.face_recognition_model);
    }
    // dataUpdatedAt: a reload that brings back the same values still resets the controls
  }, [settings, isLoading, dataUpdatedAt]);

  // A fragment: the dialog and the card, inside the admin page's admin-site section.
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
          <Title order={4}>
            {t("adminarea.sitesettings")}
            <SectionLink />
          </Title>

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
            <SkipPatternsSetting />
            <MissingPhotosLimitSetting />
            <AutoScanSetting />
            <TrashRetentionSetting />
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
                data={translateOptions(MAP_API_PROVIDERS, t, "")}
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
                <Text>{t("sitesettings.ocr_model_header")}</Text>
                <Text fz="sm" c="dimmed">
                  {t("sitesettings.ocr_model_description")}
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
                <Text>{t("sitesettings.face_recognition_model_header")}</Text>
                <Text fz="sm" c="dimmed">
                  {t("sitesettings.face_recognition_model_description")}
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
    </>
  );
}
