import type { SiteSettings as SiteSettingsValues } from "@librephotos/api-client";
import { Button, Grid, Group, Modal, Select, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { AutoScanSetting } from "./AutoScanSetting";
import { NoticeSiteSettings } from "./NoticeSiteSettings";
import { PlaceNameLanguageSetting } from "./PlaceNameLanguageSetting";
import { CONTROL_SPAN, LABEL_SPAN, MissingPhotosLimitSetting, SkipPatternsSetting } from "./ScanSettings";
import { SettingsCard } from "./SettingsCard";
import { SectionLink } from "./SettingsSection";
import { SsoSettingsGroup } from "./SsoSettings";
import { TrashRetentionSetting } from "./TrashRetentionSetting";
import { UpdateCheckSetting } from "./UpdateCheckSetting";
import { useSiteSettingDraft } from "./useSiteSettingDraft";

/** What an option's label says about it, after the product name; translated at render time. */
type OptionHint = "default" | "lightweight_default" | "fastest" | "most_accurate" | "offline";

type ModelOption = { value: string; label: string; hint?: OptionHint };

/** `place_language`: it can be asked to name places in a language (GEOCODE_LANGUAGE, #2745). */
type MapApiProvider = ModelOption & { data: { use_api_key: boolean; url: string; place_language: boolean } };

const MAP_API_PROVIDERS: MapApiProvider[] = [
  // ExifTool's own Geolocation database (#2302): no network, no API key.
  {
    value: "exiftool",
    label: "ExifTool",
    hint: "offline",
    data: { use_api_key: false, url: "https://exiftool.org/geolocation.html", place_language: false },
  },
  {
    value: "nominatim",
    label: "Nominatim (OpenStreetMap)",
    data: { use_api_key: false, url: "https://nominatim.org/", place_language: true },
  },
  {
    value: "mapbox",
    label: "Mapbox",
    data: { use_api_key: true, url: "https://www.mapbox.com/", place_language: false },
  },
  {
    value: "maptiler",
    label: "MapTiler",
    data: { use_api_key: true, url: "https://www.maptiler.com/", place_language: true },
  },
  {
    value: "opencage",
    label: "OpenCage",
    data: { use_api_key: true, url: "https://opencagedata.com/", place_language: true },
  },
  {
    value: "tomtom",
    label: "TomTom",
    data: { use_api_key: true, url: "https://www.tomtom.com/", place_language: true },
  },
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
    return <SiteSettingsForm settings={settingsQuery.data} />;
  }
  return (
    <SettingsCard>
      <Title order={4}>
        {t("adminarea.sitesettings")}
        <SectionLink />
      </Title>
      {failure ? <ErrorState failure={failure} compact /> : <PageLoader />}
    </SettingsCard>
  );
}

/**
 * Each control shows its stored value until it is changed, then the change while it is saved; a
 * refused save shows the stored value again. A fetch of the settings never undoes a change.
 */
function SiteSettingsForm({ settings }: Readonly<{ settings: SiteSettingsValues }>) {
  const mapApiKey = useSiteSettingDraft(settings.map_api_key, value => ({ map_api_key: value }));
  const mapApiProvider = useSiteSettingDraft(settings.map_api_provider, value => ({ map_api_provider: value }));
  const mapTileProvider = useSiteSettingDraft(settings.map_tile_provider, value => ({ map_tile_provider: value }));
  const allowRegistration = useSiteSettingDraft(settings.allow_registration, value => ({ allow_registration: value }));
  const allowUpload = useSiteSettingDraft(settings.allow_upload, value => ({ allow_upload: value }));
  const nextcloudEnabled = useSiteSettingDraft(settings.nextcloud_enabled, value => ({ nextcloud_enabled: value }));
  const autoCreateUserDirectory = useSiteSettingDraft(settings.auto_create_user_directory ?? false, value => ({
    auto_create_user_directory: value,
  }));
  const captioningModel = useSiteSettingDraft(settings.captioning_model, value => ({ captioning_model: value }));
  // A model picked here waits as the draft while the confirmation is open.
  const ocrModel = useSiteSettingDraft(normalizeOcrModel(settings.ocr_model), value => ({ ocr_model: value }));
  const faceRecognitionModel = useSiteSettingDraft(settings.face_recognition_model, value => ({
    face_recognition_model: value,
  }));
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);
  const mapProvider = MAP_API_PROVIDERS.find(provider => provider.value === mapApiProvider.value);

  // The text fields save on blur and on Enter; only what changed is sent.
  const saveMapApiKey = () => void mapApiKey.commit();

  const dismissOcrWarning = () => {
    ocrModel.discard();
    close();
  };

  const confirmOcrWarning = () => {
    void ocrModel.commit();
    close();
  };

  // A fragment: the dialog and the card, inside the admin page's admin-site section.
  return (
    <>
      <Modal
        opened={opened}
        onClose={dismissOcrWarning}
        // Plain text: the title is already an h2, and the app theme styles it like every other dialog.
        title={t("sitesettings.ocr_warning_header")}
      >
        <Stack>
          <Text>{t("sitesettings.ocr_warning")}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={dismissOcrWarning}>
              {t("cancel")}
            </Button>
            <Button onClick={confirmOcrWarning} color="red">
              {t("save")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <SettingsCard>
        <Stack>
          <Title order={4}>
            {t("adminarea.sitesettings")}
            <SectionLink />
          </Title>

          <Switch
            label={t("sitesettings.header")}
            onChange={event => void allowRegistration.commit(event.currentTarget.checked)}
            checked={allowRegistration.value}
          />
          <Switch
            label={t("sitesettings.headerupload")}
            onChange={event => void allowUpload.commit(event.currentTarget.checked)}
            checked={allowUpload.value}
          />
          <Switch
            label={t("sitesettings.headernextcloud")}
            onChange={event => void nextcloudEnabled.commit(event.currentTarget.checked)}
            checked={nextcloudEnabled.value}
          />
          <Switch
            label={t("sitesettings.headerautocreateuserdirectory")}
            description={t("sitesettings.autocreateuserdirectory")}
            onChange={event => void autoCreateUserDirectory.commit(event.currentTarget.checked)}
            checked={autoCreateUserDirectory.value}
          />
          <UpdateCheckSetting />
          <NoticeSiteSettings />
          <SsoSettingsGroup />

          <Grid justify="flex-end">
            <SkipPatternsSetting />
            <MissingPhotosLimitSetting />
            <AutoScanSetting />
            <TrashRetentionSetting />
            <Grid.Col span={LABEL_SPAN}>
              <Stack gap={0}>
                <Text>{t("sitesettings.map_api_provider_header")}</Text>
                <Text fz="sm" c="dimmed">
                  {t("sitesettings.map_api_provider_description", { url: mapProvider?.data.url })}
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
                value={mapApiProvider.value}
                onChange={provider => {
                  if (provider) void mapApiProvider.commit(provider);
                }}
              />
            </Grid.Col>
            <PlaceNameLanguageSetting provider={mapProvider} />
            {mapProvider?.data.use_api_key && (
              <>
                <Grid.Col span={LABEL_SPAN}>
                  <Stack gap={0}>
                    <Text>{t("sitesettings.map_api_key_header")}</Text>
                    <Text fz="sm" c="dimmed">
                      {t("sitesettings.map_api_key_description", { url: mapProvider?.data.url })}
                    </Text>
                  </Stack>
                </Grid.Col>
                <Grid.Col span={CONTROL_SPAN}>
                  <TextInput
                    value={mapApiKey.value}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        saveMapApiKey();
                      }
                    }}
                    onBlur={saveMapApiKey}
                    onChange={e => mapApiKey.edit(e.target.value)}
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
                value={mapTileProvider.value}
                onChange={provider => void mapTileProvider.commit(provider || "photoprism")}
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
                value={captioningModel.value}
                onChange={model => {
                  if (model) void captioningModel.commit(model);
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
                value={ocrModel.value}
                onChange={model => {
                  const value = normalizeOcrModel(model);
                  if (value === OCR_DISABLED) {
                    void ocrModel.commit(value);
                    return;
                  }
                  // Turning OCR on has privacy consequences, so let the admin confirm first.
                  ocrModel.edit(value);
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
                value={faceRecognitionModel.value}
                onChange={model => void faceRecognitionModel.commit(model ?? "buffalo_sc")}
              />
            </Grid.Col>
          </Grid>
        </Stack>
      </SettingsCard>
    </>
  );
}
