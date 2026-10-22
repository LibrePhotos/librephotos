import { Alert, Button, Grid, Group, Select, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconInfoCircle } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLookUpPlacesMutation } from "../../api_client/jobs/hooks";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { intlLocale } from "../../util/formatCount";
import { ConfirmModal } from "../modals/ConfirmModal";
import { isLanguageCode, placeLanguageName, placeLanguageOptions, PROVIDER_DEFAULT } from "./placeLanguageOptions";
import { CONTROL_SPAN, SettingLabel } from "./ScanSettings";
import { useSaveSiteSettings } from "./useSaveSiteSettings";

type Props = Readonly<{
  /**
   * The Map Provider set now: its name, for the reason the setting does nothing with it, and
   * whether it can be asked for a language (`place_language`: not Mapbox or ExifTool).
   */
  provider: Readonly<{ label: string; data: Readonly<{ place_language: boolean }> }> | undefined;
}>;

/**
 * The language online map providers name places in (#2745), under the Map Provider. "Provider
 * default", the default, sends no language, as before the setting. A change renames nothing: an alert
 * then offers the Admin tools job that looks every photo's place up again. With a provider that
 * cannot be asked, the Select is disabled and its description says why; the value is kept.
 */
export function PlaceNameLanguageSetting({ provider }: Props) {
  const supported = provider?.data.place_language ?? false;
  const { t, i18n } = useTranslation();
  const { data: settings, dataUpdatedAt } = useGetSettingsQuery();
  const save = useSaveSiteSettings();
  const stored = settings?.geocode_language ?? "";
  const [language, setLanguage] = useState(stored);
  const [search, setSearch] = useState("");
  // The language picked here, until the admin starts the lookup or puts it off.
  const [changedTo, setChangedTo] = useState<string | null>(null);
  const header = t("sitesettings.placelanguage_header");

  useEffect(() => {
    setLanguage(stored);
    // dataUpdatedAt: a reload that brings back the same value still resets the field
  }, [stored, dataUpdatedAt]);

  // A code being typed ("pt-BR", "de,en") is offered as it is.
  const typed = search.replace(/\s/g, "");
  const data = placeLanguageOptions(t, intlLocale(i18n.resolvedLanguage), [
    language,
    isLanguageCode(typed) ? typed : "",
  ]);

  const choose = (value: string | null) => {
    const next = value === null || value === PROVIDER_DEFAULT ? "" : value;
    if (next === language) return;
    setLanguage(next);
    setChangedTo(next);
    save({ geocode_language: next });
  };

  return (
    <>
      <SettingLabel header={header} description={t("sitesettings.placelanguage_description")} />
      <Grid.Col span={CONTROL_SPAN}>
        <Select
          aria-label={header}
          searchable
          allowDeselect={false}
          placeholder={t("sitesettings.placelanguage_search")}
          disabled={!supported}
          description={
            supported ? undefined : t("sitesettings.placelanguage_unsupported", { provider: provider?.label ?? "" })
          }
          // The reason under the greyed field, where the eye goes, not above it
          inputWrapperOrder={["label", "input", "description", "error"]}
          data={data}
          value={language || PROVIDER_DEFAULT}
          searchValue={search}
          onSearchChange={setSearch}
          onChange={choose}
        />
      </Grid.Col>
      {/* Once the server has it: a refused save puts the old value back and shows no alert. */}
      {supported && changedTo === stored && (
        <Grid.Col span={12}>
          <PlaceLanguageChangedAlert language={changedTo} onDone={() => setChangedTo(null)} />
        </Grid.Col>
      )}
    </>
  );
}

/** Says that the photos named already keep their names, and offers to look them up again. */
function PlaceLanguageChangedAlert({ language, onDone }: Readonly<{ language: string; onDone: () => void }>) {
  const { t } = useTranslation();
  const { mutate: lookUpPlaces, isPending } = useLookUpPlacesMutation();
  const [confirmOpen, { open, close }] = useDisclosure(false);

  return (
    <Alert
      variant="light"
      icon={<IconInfoCircle size={18} />}
      title={
        language
          ? t("sitesettings.placelanguage_changedtitle", { language: placeLanguageName(t, language) })
          : t("sitesettings.placelanguage_changeddefaulttitle")
      }
    >
      <Stack gap="xs">
        <Text size="sm">{t("sitesettings.placelanguage_changed")}</Text>
        <Group gap="xs">
          <Button size="xs" onClick={open}>
            {t("sitesettings.placelanguage_lookup")}
          </Button>
          <Button size="xs" variant="subtle" onClick={onDone}>
            {t("sitesettings.placelanguage_later")}
          </Button>
        </Group>
      </Stack>
      {/* The Admin tools job's own confirmation (LookUpPlacesTool) */}
      <ConfirmModal
        opened={confirmOpen}
        onClose={close}
        onConfirm={() => lookUpPlaces(undefined, { onSuccess: onDone, onSettled: close })}
        title={t("adminarea.lookupplacesconfirmtitle")}
        message={t("adminarea.lookupplacesconfirm")}
        confirmLabel={t("adminarea.lookupplacesconfirmbutton")}
        loading={isPending}
      />
    </Alert>
  );
}
