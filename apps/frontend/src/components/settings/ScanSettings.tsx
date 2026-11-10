import { Grid, NumberInput, Stack, Text, TextInput } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { useSiteSettingDraft } from "./useSiteSettingDraft";

// Label and control side by side from the sm breakpoint up, stacked on a phone.
export const LABEL_SPAN = { base: 12, sm: 8 };
export const CONTROL_SPAN = { base: 12, sm: 4 };

export function SettingLabel({ header, description }: { header: string; description: string }) {
  return (
    <Grid.Col span={LABEL_SPAN}>
      <Stack gap={0}>
        <Text>{header}</Text>
        <Text fz="sm" c="dimmed">
          {description}
        </Text>
      </Stack>
    </Grid.Col>
  );
}

/**
 * The folder name patterns a scan ignores. Saves on blur and on Enter, only when changed. What is
 * typed stays while the settings are fetched again; a refused save puts the stored value back (#2222).
 */
export function SkipPatternsSetting() {
  const { t } = useTranslation();
  const { data: settings } = useGetSettingsQuery();
  const skipPatterns = useSiteSettingDraft(settings?.skip_patterns ?? "", value => ({ skip_patterns: value }));
  const commit = () => void skipPatterns.commit();

  return (
    <>
      <SettingLabel header={t("sitesettings.headerskippatterns")} description={t("sitesettings.skippatterns")} />
      <Grid.Col span={CONTROL_SPAN}>
        <TextInput
          value={skipPatterns.value}
          onKeyDown={e => {
            if (e.key === "Enter") commit();
          }}
          onBlur={commit}
          onChange={event => skipPatterns.edit(event.currentTarget.value)}
        />
      </Grid.Col>
    </>
  );
}

const DEFAULT_MISSING_LIMIT = 0.5;

/** The fraction as the whole percent the field shows. */
const toPercent = (fraction: number) => Math.round(fraction * 100);

/**
 * How much of a user's library one scan may mark missing before it stops and asks whether the
 * library is mounted (#2195). Stored as a fraction, shown as a percent; 100% turns the check off.
 */
export function MissingPhotosLimitSetting() {
  const { t } = useTranslation();
  const { data: settings } = useGetSettingsQuery();
  const stored = settings?.scan_missing_max_fraction ?? DEFAULT_MISSING_LIMIT;
  const percent = useSiteSettingDraft<number | string>(toPercent(stored), value => ({
    scan_missing_max_fraction: typeof value === "number" ? value / 100 : stored,
  }));

  const savePercent = () => {
    // An emptied field puts back the stored value instead of saving nothing as 0%.
    if (typeof percent.value !== "number") {
      percent.discard();
      return;
    }
    void percent.commit();
  };

  return (
    <>
      <SettingLabel
        header={t("sitesettings.headerscanmissingmaxfraction")}
        description={t("sitesettings.scanmissingmaxfraction")}
      />
      <Grid.Col span={CONTROL_SPAN}>
        <NumberInput
          aria-label={t("sitesettings.headerscanmissingmaxfraction")}
          value={percent.value}
          min={0}
          max={100}
          step={5}
          clampBehavior="strict"
          allowDecimal={false}
          suffix="%"
          onKeyDown={e => {
            if (e.key === "Enter") {
              savePercent();
            }
          }}
          onBlur={savePercent}
          onChange={percent.edit}
        />
      </Grid.Col>
    </>
  );
}
