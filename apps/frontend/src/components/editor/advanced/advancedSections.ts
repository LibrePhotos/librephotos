/**
 * The advanced mode's panel, as data: an ordered list of sections, each a collapsible PanelSection
 * with a Reset. A section is plain sliders built from the control table (`controls`), or its own
 * component (`Content`). New panels (histogram, tone curve, colour mixer, B&W mix, colour grading,
 * presets, history) are added by appending to ADVANCED_SECTIONS; SECTION_ORDER says where each one
 * goes, so the list's order of appending does not matter.
 */
import type { ParseKeys } from "i18next";
import type React from "react";
import { withDefaultGeometry, withDefaults } from "../controls/resetControls";
import { CropControls } from "../crop/CropControls";
import type { NumberControlPath } from "../engine/controls";
import { changesGeometry, type Recipe } from "../engine/recipe";

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

/** The sections of the advanced mode. Append a new panel here. */
export const ADVANCED_SECTIONS: AdvancedSection[] = [
  { id: "light", title: "editor.advanced.light", controls: LIGHT },
  { id: "color", title: "editor.advanced.color", controls: COLOR },
  { id: "effects", title: "editor.advanced.effects", controls: EFFECTS, collapsed: true },
  { id: "detail", title: "editor.advanced.detail", controls: DETAIL, collapsed: true },
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

/** Every number control's label in the advanced mode (the recipe table's UI labels). */
export const CONTROL_LABELS: Readonly<Partial<Record<NumberControlPath, ParseKeys>>> = {
  "light.exposure": "editor.control.exposure",
  "light.contrast": "editor.control.contrast",
  "light.highlights": "editor.control.highlights",
  "light.shadows": "editor.control.shadows",
  "light.whites": "editor.control.whites",
  "light.blacks": "editor.control.blacks",
  "wb.temp": "editor.control.temperature",
  "wb.tint": "editor.control.tint",
  "color.vibrance": "editor.control.vibrance",
  "color.saturation": "editor.control.saturation",
  "effects.texture": "editor.control.texture",
  "effects.clarity": "editor.control.clarity",
  "effects.dehaze": "editor.control.dehaze",
  "vignette.amount": "editor.control.vignette",
  "vignette.midpoint": "editor.control.midpoint",
  "vignette.feather": "editor.control.feather",
  "vignette.roundness": "editor.control.roundness",
  "grain.amount": "editor.control.grain",
  "grain.size": "editor.control.grainSize",
  "grain.roughness": "editor.control.roughness",
  "detail.sharpen_amount": "editor.control.sharpening",
  "detail.sharpen_radius": "editor.control.radius",
  "detail.nr_luminance": "editor.control.noiseReduction",
  "detail.nr_color": "editor.control.colorNoise",
};
