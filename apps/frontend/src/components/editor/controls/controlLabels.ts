/** The names of the number controls, as translation keys (the recipe table's UI labels). */
import type { ParseKeys } from "i18next";
import type { NumberControlPath } from "../engine/controls";

/** Every number control's label in the advanced mode (the recipe table's UI labels). */
export const CONTROL_LABELS: Readonly<Partial<Record<NumberControlPath, ParseKeys>>> = {
  "geometry.straighten": "editor.crop.straighten",
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
  "grading.blending": "editor.grading.blending",
  "grading.balance": "editor.grading.balance",
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
