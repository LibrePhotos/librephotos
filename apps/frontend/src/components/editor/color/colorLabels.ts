/** The names of the colour bands, the mixer's three sliders and the grading wheels, as translation keys. */
import type { EditBand } from "@librephotos/api-client";
import type { ParseKeys } from "i18next";
import type { GradingWheel } from "../engine/recipe";

export const MIXER_CHANNELS = ["hue", "sat", "lum"] as const;
export type MixerChannel = (typeof MIXER_CHANNELS)[number];

export const BAND_LABELS: Readonly<Record<EditBand, ParseKeys>> = {
  red: "editor.band.red",
  orange: "editor.band.orange",
  yellow: "editor.band.yellow",
  green: "editor.band.green",
  aqua: "editor.band.aqua",
  blue: "editor.band.blue",
  purple: "editor.band.purple",
  magenta: "editor.band.magenta",
};

export const MIXER_CHANNEL_LABELS: Readonly<Record<MixerChannel, ParseKeys>> = {
  hue: "editor.mixer.hue",
  sat: "editor.mixer.saturation",
  lum: "editor.mixer.luminance",
};

/** A mixer slider's full name, with its band ("Orange saturation"): its accessible name and its history step. */
export const MIXER_SLIDER_NAMES: Readonly<Record<MixerChannel, ParseKeys>> = {
  hue: "editor.history.mixerHue",
  sat: "editor.history.mixerSaturation",
  lum: "editor.history.mixerLuminance",
};

/** The grading wheels in the panel's order. */
export const GRADING_WHEELS: readonly GradingWheel[] = ["shadows", "midtones", "highlights", "global"];

export const WHEEL_LABELS: Readonly<Record<GradingWheel, ParseKeys>> = {
  shadows: "editor.grading.shadows",
  midtones: "editor.grading.midtones",
  highlights: "editor.grading.highlights",
  global: "editor.grading.global",
};
