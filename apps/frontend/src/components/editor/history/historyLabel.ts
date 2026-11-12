/**
 * A history step's label in words, built when shown (never stored): the control's translated name
 * and its formatted value ("Exposure +0.35"), or what the step did ("Crop", "Filter: Vivid",
 * "Auto", "Paste settings", "Reset").
 */
import { EDIT_BANDS, type EditBand, type EditHistoryStep } from "@librephotos/api-client";
import type { ParseKeys, TFunction } from "i18next";
import {
  BAND_LABELS,
  GRADING_WHEELS,
  MIXER_CHANNELS,
  MIXER_SLIDER_NAMES,
  WHEEL_LABELS,
  type MixerChannel,
} from "../color/colorLabels";
import { CONTROL_LABELS } from "../controls/controlLabels";
import { formatValue, sliderSpec } from "../controls/sliderSpec";
import { isNumberControl, type ControlPath, type NumberControlPath } from "../engine/controls";
import type { CurveChannel, GradingWheel } from "../engine/recipe";
import { FILTER_IDS, ORIGINAL_FILTER } from "../filters/filters";
import { stepLabel } from "../state/stepLabel";

const CURVE_LABELS: Readonly<Record<CurveChannel, ParseKeys>> = {
  master: "editor.history.curveMaster",
  red: "editor.history.curveRed",
  green: "editor.history.curveGreen",
  blue: "editor.history.curveBlue",
};

const bandOf = (name: string | undefined): EditBand | undefined => EDIT_BANDS.find(band => band === name);
const wheelOf = (name: string | undefined): GradingWheel | undefined => GRADING_WHEELS.find(wheel => wheel === name);
const mixerChannelOf = (name: string | undefined): MixerChannel | undefined =>
  MIXER_CHANNELS.find(channel => channel === name);

/** The name of a colour band or grading control; null for any other path. */
function colorControlName(path: NumberControlPath, t: TFunction): string | null {
  const [group, first, second] = path.split(".");
  const band = bandOf(first);
  const channel = mixerChannelOf(second);
  if (group === "mixer" && band && channel) return t(MIXER_SLIDER_NAMES[channel], { band: t(BAND_LABELS[band]) });
  if (group === "bw_mix" && band) return t("editor.history.bwMix", { band: t(BAND_LABELS[band]) });
  const wheel = wheelOf(first);
  if (group === "grading" && wheel) {
    const name = t(WHEEL_LABELS[wheel]);
    return second === "lum"
      ? t("editor.grading.wheelLuminance", { wheel: name })
      : t("editor.history.wheel", { wheel: name });
  }
  return null;
}

/** A number control's label with its value: "Exposure +0.35", "Shadows color" (a wheel's colour shows no number). */
function numberLabel(path: NumberControlPath, value: unknown, t: TFunction): string {
  const key = CONTROL_LABELS[path];
  const name = key ? t(key) : (colorControlName(path, t) ?? path);
  if (/^grading\.\w+\.(hue|sat)$/.test(path)) return name;
  return typeof value === "number" ? `${name} ${formatValue(sliderSpec(path), value)}` : name;
}

/** The label of a `set` step of any control. */
function setLabel(control: ControlPath, value: number | boolean | string | null, t: TFunction): string {
  if (isNumberControl(control)) return numberLabel(control, value, t);
  switch (control) {
    case "geometry.orientation":
      return t("editor.history.rotate", { degrees: typeof value === "number" ? value : 0 });
    case "geometry.flip_h":
      return t("editor.crop.flipHorizontal");
    case "geometry.flip_v":
      return t("editor.crop.flipVertical");
    case "geometry.crop":
      return t("editor.history.crop");
    case "geometry.aspect":
      return t("editor.history.aspect", { ratio: typeof value === "string" ? value : t("editor.crop.free") });
    case "color.treatment":
      return value === "bw" ? t("editor.color.bw") : t("editor.history.treatmentColor");
    case "curve.master":
      return t(CURVE_LABELS.master);
    case "curve.red":
      return t(CURVE_LABELS.red);
    case "curve.green":
      return t(CURVE_LABELS.green);
    case "curve.blue":
      return t(CURVE_LABELS.blue);
  }
}

/** The name of the look a `preset` step applied. */
function presetName(id: string | null, t: TFunction): string {
  if (id === ORIGINAL_FILTER) return t("editor.filters.original");
  const filter = FILTER_IDS.find(candidate => candidate === id);
  return filter ? t(`editor.filters.${filter}`) : t("editor.history.unknown");
}

/** What a history step is called in the History panel. */
export function historyLabel(step: EditHistoryStep, t: TFunction): string {
  const label = stepLabel(step);
  switch (label.kind) {
    case "set":
      return setLabel(label.control, label.value, t);
    case "crop":
      return t("editor.history.crop");
    case "preset":
      return t("editor.history.preset", { name: presetName(label.preset, t) });
    case "auto":
      return t("editor.history.auto");
    case "paste":
      return t("editor.history.paste");
    case "reset":
      return t("editor.history.reset");
    case "import":
      return t("editor.history.import");
    case "unknown":
      return t("editor.history.unknown");
  }
}
