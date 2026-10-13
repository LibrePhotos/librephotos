import { Grid, NumberInput, Stack, Text, TextInput } from "@mantine/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { useSaveSiteSettings } from "./useSaveSiteSettings";

// Label and control side by side from the sm breakpoint up, stacked on a phone.
export const LABEL_SPAN = { base: 12, sm: 8 };
export const CONTROL_SPAN = { base: 12, sm: 4 };

function SettingLabel({ header, description }: { header: string; description: string }) {
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
 * The folder name patterns a scan ignores. Saves on blur and on Enter, only when changed. Like
 * the other site settings, every reload of the settings (also after a refused save) puts the
 * field back to what the server has (#2222).
 */
export function SkipPatternsSetting() {
  const { t } = useTranslation();
  const { data: settings, dataUpdatedAt } = useGetSettingsQuery();
  const save = useSaveSiteSettings();
  const [skipPatterns, setSkipPatterns] = useState("");

  useEffect(() => {
    if (settings) setSkipPatterns(settings.skip_patterns);
    // dataUpdatedAt: a reload that brings back the same values still resets the field
  }, [settings, dataUpdatedAt]);

  const saveSkipPatterns = () => {
    if (settings && skipPatterns !== settings.skip_patterns) {
      save({ skip_patterns: skipPatterns });
    }
  };

  return (
    <>
      <SettingLabel header={t("sitesettings.headerskippatterns")} description={t("sitesettings.skippatterns")} />
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
  const { data: settings, dataUpdatedAt } = useGetSettingsQuery();
  const save = useSaveSiteSettings();
  const stored = settings?.scan_missing_max_fraction ?? DEFAULT_MISSING_LIMIT;
  const [percent, setPercent] = useState<number | string>(toPercent(stored));

  useEffect(() => {
    setPercent(toPercent(stored));
    // dataUpdatedAt: a reload that brings back the same value still resets the field
  }, [stored, dataUpdatedAt]);

  const savePercent = () => {
    // An emptied field puts back the stored value instead of saving nothing as 0%.
    if (typeof percent !== "number") {
      setPercent(toPercent(stored));
      return;
    }
    if (settings && percent !== toPercent(stored)) {
      save({ scan_missing_max_fraction: percent / 100 });
    }
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
          value={percent}
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
          onChange={setPercent}
        />
      </Grid.Col>
    </>
  );
}
