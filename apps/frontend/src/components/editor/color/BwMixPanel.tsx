import { EDIT_BANDS } from "@librephotos/api-client";
import { Stack } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { EditSlider } from "../controls/EditSlider";
import { BAND_LABELS } from "./colorLabels";

/** The B&W mix section (black and white only): how bright each colour band turns in grey. */
export function BwMixPanel() {
  const { t } = useTranslation();
  return (
    <Stack gap={4}>
      {EDIT_BANDS.map(band => (
        <EditSlider
          key={band}
          path={`bw_mix.${band}`}
          label={t(BAND_LABELS[band])}
          name={t("editor.history.bwMix", { band: t(BAND_LABELS[band]) })}
        />
      ))}
    </Stack>
  );
}
