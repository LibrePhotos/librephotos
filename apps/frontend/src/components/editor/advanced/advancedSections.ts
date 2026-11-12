/**
 * The advanced mode's panel, as data: an ordered list of sections, each a collapsible PanelSection
 * with a Reset. A section is plain sliders built from the control table (`controls`), or its own
 * component (`Content`). New panels (histogram, tone curve, colour mixer, B&W mix, colour grading,
 * presets, history) are added by appending to ADVANCED_SECTIONS; SECTION_ORDER says where each one
 * goes, so the list's order of appending does not matter.
 */
import { EDIT_BANDS } from "@librephotos/api-client";
import type { ParseKeys } from "i18next";
import type React from "react";
import { AutoRow } from "../auto/AutoButton";
import { BwMixPanel } from "../color/BwMixPanel";
import { MIXER_CHANNELS } from "../color/colorLabels";
import { MixerPanel } from "../color/MixerPanel";
import { TreatmentSwitch } from "../color/TreatmentSwitch";
import { anyChanged, withDefaultGeometry, withDefaults } from "../controls/resetControls";
import { CropControls } from "../crop/CropControls";
import { ToneCurvePanel } from "../curve/ToneCurvePanel";
import type { NumberControlPath } from "../engine/controls";
import { changesGeometry, DEFAULT_RECIPE, sameValue, type Recipe } from "../engine/recipe";
import { PresetsPanel } from "../filters/PresetsPanel";
import { GradingPanel } from "../grading/GradingPanel";
import { HistogramPanel } from "../histogram/HistogramPanel";
import { HistoryPanel } from "../history/HistoryPanel";

/** Every section the advanced mode has or is planned to have. */
type AdvancedSectionId =
  | "histogram"
  | "presets"
  | "light"
  | "toneCurve"
  | "color"
  | "colorMixer"
  | "bwMix"
  | "colorGrading"
  | "effects"
  | "detail"
  | "crop"
  | "history";

/** Where a section sits, top to bottom (Lightroom's order: the histogram first, history last). */
const SECTION_ORDER: Readonly<Record<AdvancedSectionId, number>> = {
  histogram: 0,
  presets: 10,
  light: 20,
  toneCurve: 30,
  color: 40,
  colorMixer: 50,
  bwMix: 60,
  colorGrading: 70,
  effects: 80,
  detail: 90,
  crop: 100,
  history: 110,
};

export type AdvancedSection = Readonly<{
  id: AdvancedSectionId;
  /** The heading. A section without one (the histogram) is drawn bare: no heading, no Reset, never collapsed. */
  title?: ParseKeys;
  /** Plain sliders, in this order; each control's label comes from CONTROL_LABELS. */
  controls?: readonly NumberControlPath[];
  /** The section's own content, below its sliders (or instead of them). Reads the editor with useEditor(). */
  Content?: React.ComponentType;
  /** Shown above its sliders (Auto, the Color | Black & white switch). */
  Top?: React.ComponentType;
  /** Whether the section is shown for this recipe (the B&W mix only for black and white); default: always. */
  shown?: (recipe: Recipe) => boolean;
  /** What the section's Reset makes of the recipe (one `reset` step); default: its `controls` at their defaults. */
  reset?: (recipe: Recipe) => Recipe;
  /** Whether the section holds a change (shows its Reset); default: any of its `controls` changed. */
  changed?: (recipe: Recipe) => boolean;
  /** The section is the crop tool: open means the tool is up. */
  cropTool?: boolean;
  /** Collapsed when the editor opens. */
  collapsed?: boolean;
}>;

const LIGHT: readonly NumberControlPath[] = [
  "light.exposure",
  "light.contrast",
  "light.highlights",
  "light.shadows",
  "light.whites",
  "light.blacks",
];
const COLOR: readonly NumberControlPath[] = ["wb.temp", "wb.tint", "color.vibrance", "color.saturation"];
const EFFECTS: readonly NumberControlPath[] = [
  "effects.texture",
  "effects.clarity",
  "effects.dehaze",
  "vignette.amount",
  "vignette.midpoint",
  "vignette.feather",
  "vignette.roundness",
  "grain.amount",
  "grain.size",
  "grain.roughness",
];
const DETAIL: readonly NumberControlPath[] = [
  "detail.sharpen_amount",
  "detail.sharpen_radius",
  "detail.nr_luminance",
  "detail.nr_color",
];

const MIXER: readonly NumberControlPath[] = EDIT_BANDS.flatMap(band =>
  MIXER_CHANNELS.map(channel => `mixer.${band}.${channel}` as const)
);
const BW_MIX: readonly NumberControlPath[] = EDIT_BANDS.map(band => `bw_mix.${band}` as const);
const isBw = (recipe: Recipe) => recipe.color.treatment === "bw";

/** The sections of the advanced mode. Append a new panel here. */
export const ADVANCED_SECTIONS: AdvancedSection[] = [
  { id: "histogram", Content: HistogramPanel },
  {
    id: "presets",
    title: "editor.advanced.presets",
    Content: PresetsPanel,
    // Taking the look off is the Original row; the section has no Reset of its own.
    changed: () => false,
    collapsed: true,
  },
  { id: "light", title: "editor.advanced.light", controls: LIGHT, Top: AutoRow },
  {
    id: "toneCurve",
    title: "editor.advanced.toneCurve",
    Content: ToneCurvePanel,
    reset: recipe => ({ ...recipe, curve: DEFAULT_RECIPE.curve }),
    changed: recipe => !sameValue(recipe.curve, DEFAULT_RECIPE.curve),
    collapsed: true,
  },
  { id: "color", title: "editor.advanced.color", controls: COLOR, Top: TreatmentSwitch },
  {
    id: "colorMixer",
    title: "editor.advanced.colorMixer",
    Content: MixerPanel,
    reset: recipe => withDefaults(recipe, MIXER),
    changed: recipe => anyChanged(recipe, MIXER),
    shown: recipe => !isBw(recipe),
    collapsed: true,
  },
  {
    id: "bwMix",
    title: "editor.advanced.bwMix",
    Content: BwMixPanel,
    reset: recipe => withDefaults(recipe, BW_MIX),
    changed: recipe => anyChanged(recipe, BW_MIX),
    shown: isBw,
  },
  {
    id: "colorGrading",
    title: "editor.advanced.colorGrading",
    Content: GradingPanel,
    reset: recipe => ({ ...recipe, grading: DEFAULT_RECIPE.grading }),
    changed: recipe => !sameValue(recipe.grading, DEFAULT_RECIPE.grading),
    collapsed: true,
  },
  { id: "effects", title: "editor.advanced.effects", controls: EFFECTS, collapsed: true },
  { id: "detail", title: "editor.advanced.detail", controls: DETAIL, collapsed: true },
  { id: "history", title: "editor.advanced.history", Content: HistoryPanel, changed: () => false },
  {
    id: "crop",
    title: "editor.advanced.crop",
    Content: CropControls,
    reset: withDefaultGeometry,
    changed: changesGeometry,
    cropTool: true,
  },
];

/** A section's Reset: its own, else its controls back to their defaults. */
export function resetSection(section: AdvancedSection, recipe: Recipe): Recipe {
  return section.reset ? section.reset(recipe) : withDefaults(recipe, section.controls ?? []);
}

/** The sections in their order. */
export function orderedSections(sections: readonly AdvancedSection[]): AdvancedSection[] {
  return [...sections].sort((a, b) => SECTION_ORDER[a.id] - SECTION_ORDER[b.id]);
}
