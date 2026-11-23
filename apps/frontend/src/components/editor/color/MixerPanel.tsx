import { EDIT_BANDS, type EditBand } from "@librephotos/api-client";
import { Group, Stack, Text, UnstyledButton } from "@mantine/core";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EditSlider } from "../controls/EditSlider";
import { PixelCanvas } from "../controls/PixelCanvas";
import { useEditor } from "../EditorContext";
import { bandColor, swatchPixels } from "./bandColors";
import { BAND_LABELS, MIXER_CHANNEL_LABELS, MIXER_CHANNELS, MIXER_SLIDER_NAMES } from "./colorLabels";
import classes from "./MixerPanel.module.css";

const CHIP = 8;

/** A band's chip: its colour, a ring when it is the one shown, a dot when it holds a change. */
function BandChip({
  band,
  selected,
  changed,
  onSelect,
}: Readonly<{ band: EditBand; selected: boolean; changed: boolean; onSelect: () => void }>) {
  const { t } = useTranslation();
  const pixels = useMemo(() => swatchPixels(bandColor(band), CHIP, CHIP), [band]);
  const name = t(BAND_LABELS[band]);
  return (
    <UnstyledButton
      className={classes.chip}
      aria-pressed={selected}
      aria-label={changed ? t("editor.mixer.bandChanged", { band: name }) : name}
      title={name}
      onClick={onSelect}
    >
      <PixelCanvas pixels={pixels} width={CHIP} height={CHIP} className={classes.swatch} />
      {changed && <span className={classes.dot} aria-hidden />}
    </UnstyledButton>
  );
}

/** The Color mixer section: a chip per band, and the hue, saturation and luminance of the chosen one. */
export function MixerPanel() {
  const { t } = useTranslation();
  const { session } = useEditor();
  const [band, setBand] = useState<EditBand>("red");
  const mixer = session.recipe.mixer;
  const isChanged = (of: EditBand) => MIXER_CHANNELS.some(channel => mixer[of][channel] !== 0);
  return (
    <Stack gap={4}>
      <Group gap={4} wrap="nowrap" justify="space-between" role="group" aria-label={t("editor.mixer.bands")}>
        {EDIT_BANDS.map(of => (
          <BandChip key={of} band={of} selected={of === band} changed={isChanged(of)} onSelect={() => setBand(of)} />
        ))}
      </Group>
      <Text size="xs" c="dimmed" mt={4}>
        {t(BAND_LABELS[band])}
      </Text>
      {MIXER_CHANNELS.map(channel => (
        <EditSlider
          key={channel}
          path={`mixer.${band}.${channel}`}
          label={t(MIXER_CHANNEL_LABELS[channel])}
          name={t(MIXER_SLIDER_NAMES[channel], { band: t(BAND_LABELS[band]) })}
        />
      ))}
    </Stack>
  );
}
