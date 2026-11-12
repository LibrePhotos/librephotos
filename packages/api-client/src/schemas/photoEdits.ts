import { z } from "zod";

/*
 * Photo edits: the edit recipe, its history and the edit of one photo, as the photo editing
 * pipeline describes them (apps/docs/docs/development/photo-editing.md). A recipe is sparse: a
 * missing key means its default. Unknown keys and numbers outside their range are rejected, never
 * clamped.
 */

const between = (min: number, max: number) => z.number().min(min).max(max);
const unit = between(0, 1);
const signed100 = between(-100, 100);
const percent = between(0, 100);

/** The colour bands of the mixer and of the B&W mix, in hue order. */
export const EDIT_BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const;
export type EditBand = (typeof EDIT_BANDS)[number];

/** The aspect ratios the crop can be locked to; each ratio's inverse is listed after it. */
export const EDIT_ASPECTS = [
  "original",
  "1:1",
  "4:5",
  "5:4",
  "5:7",
  "7:5",
  "2:3",
  "3:2",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "16:10",
  "10:16",
] as const;
export type EditAspect = (typeof EDIT_ASPECTS)[number];

/** A crop rectangle in units of the oriented picture: its centre and its size, each 0 to 1 (a size above 0). */
const size = z.number().gt(0).max(1);
export const EditCrop = z.strictObject({ cx: unit, cy: unit, w: size, h: size });
export type EditCrop = z.infer<typeof EditCrop>;

/** The points of one tone curve: 2 to 16 points `[x, y]`, each 0 to 1, x strictly increasing. */
export const EditCurvePoints = z
  .tuple([unit, unit])
  .array()
  .min(2)
  .max(16)
  .refine(points => points.every((point, i) => i === 0 || point[0] > (points[i - 1]?.[0] ?? -1)), {
    message: "x must be strictly increasing",
  });
export type EditCurvePoints = z.infer<typeof EditCurvePoints>;

const bandsOf = <T extends z.ZodType>(value: T) =>
  z.strictObject({
    red: value.optional(),
    orange: value.optional(),
    yellow: value.optional(),
    green: value.optional(),
    aqua: value.optional(),
    blue: value.optional(),
    purple: value.optional(),
    magenta: value.optional(),
  });

/*
 * The groups of a recipe, each named after its OpenAPI component (contract-map.ts), except
 * EditMixerBand (component EditBand: `EditBand` here is a band's name).
 */

export const EditGeometry = z.strictObject({
  orientation: z.literal([0, 90, 180, 270]).optional(),
  flip_h: z.boolean().optional(),
  flip_v: z.boolean().optional(),
  straighten: between(-45, 45).optional(),
  crop: EditCrop.nullable().optional(),
  aspect: z.enum(EDIT_ASPECTS).nullable().optional(),
});
export const EditWhiteBalance = z.strictObject({ temp: signed100.optional(), tint: signed100.optional() });
export const EditLight = z.strictObject({
  exposure: between(-5, 5).optional(),
  contrast: signed100.optional(),
  highlights: signed100.optional(),
  shadows: signed100.optional(),
  whites: signed100.optional(),
  blacks: signed100.optional(),
});
/** The tone curves, one per channel. */
export const EditCurve = z.strictObject({
  master: EditCurvePoints.optional(),
  red: EditCurvePoints.optional(),
  green: EditCurvePoints.optional(),
  blue: EditCurvePoints.optional(),
});
export const EditColor = z.strictObject({
  vibrance: signed100.optional(),
  saturation: signed100.optional(),
  treatment: z.enum(["color", "bw"]).optional(),
});
/** One band of the colour mixer. */
export const EditMixerBand = z.strictObject({
  hue: signed100.optional(),
  sat: signed100.optional(),
  lum: signed100.optional(),
});
export const EditMixer = bandsOf(EditMixerBand);
export const EditBwMix = bandsOf(signed100);
/** One colour grading wheel. */
export const EditWheel = z.strictObject({
  hue: between(0, 360).optional(),
  sat: percent.optional(),
  lum: signed100.optional(),
});
export const EditGrading = z.strictObject({
  shadows: EditWheel.optional(),
  midtones: EditWheel.optional(),
  highlights: EditWheel.optional(),
  global: EditWheel.optional(),
  blending: percent.optional(),
  balance: signed100.optional(),
});
export const EditEffects = z.strictObject({
  texture: signed100.optional(),
  clarity: signed100.optional(),
  dehaze: signed100.optional(),
});
export const EditVignette = z.strictObject({
  amount: signed100.optional(),
  midpoint: percent.optional(),
  feather: percent.optional(),
  roundness: signed100.optional(),
});
export const EditGrain = z.strictObject({
  amount: percent.optional(),
  size: percent.optional(),
  roughness: percent.optional(),
  seed: z.int().min(0).max(4294967295).optional(),
});
export const EditDetail = z.strictObject({
  sharpen_amount: between(0, 150).optional(),
  sharpen_radius: between(0.5, 3).optional(),
  nr_luminance: percent.optional(),
  nr_color: percent.optional(),
});

/** The edit recipe (sparse): `{"version": 1}` changes nothing. */
export const EditRecipe = z.strictObject({
  version: z.literal(1),
  geometry: EditGeometry.optional(),
  wb: EditWhiteBalance.optional(),
  light: EditLight.optional(),
  curve: EditCurve.optional(),
  color: EditColor.optional(),
  mixer: EditMixer.optional(),
  bw_mix: EditBwMix.optional(),
  grading: EditGrading.optional(),
  effects: EditEffects.optional(),
  vignette: EditVignette.optional(),
  grain: EditGrain.optional(),
  detail: EditDetail.optional(),
});
export type EditRecipe = z.infer<typeof EditRecipe>;

/** What a history step did; the UI builds its (translated) label from it. */
export const EditHistoryAction = z.enum(["set", "crop", "preset", "auto", "paste", "reset", "import"]);
export type EditHistoryAction = z.infer<typeof EditHistoryAction>;

/**
 * One step of an edit's history: the recipe after it, what it did, and when. `control` names the
 * control of a `set` step by its dotted path (`light.exposure`), `value` is its new value when that
 * is a number, boolean or string (the preset id for `preset`).
 */
export const EditHistoryStep = z.object({
  action: EditHistoryAction,
  control: z.string().max(64).nullish(),
  value: z.union([z.number(), z.boolean(), z.string().max(64)]).nullish(),
  at: z.string(),
  settings: EditRecipe,
});
export type EditHistoryStep = z.infer<typeof EditHistoryStep>;

/** The state of an edit's full-size rendition: `none` for no edit or a recipe that changes nothing. */
export const EditRendition = z.enum(["none", "pending", "ready", "failed"]);
export type EditRendition = z.infer<typeof EditRendition>;

/**
 * `GET|PUT /api/photos/<photo_id>/edit/`: a photo's edit. A photo never edited answers the default
 * recipe with `version` 0.
 */
export const PhotoEdit = z.object({
  photo_id: z.string(),
  settings: EditRecipe,
  history: EditHistoryStep.array().max(200),
  history_cursor: z.int().min(-1),
  version: z.int().min(0),
  rendition: EditRendition,
  updated_at: z.string().nullable(),
});
export type PhotoEdit = z.infer<typeof PhotoEdit>;

/** The body of `PUT /api/photos/<photo_id>/edit/`. */
export const PhotoEditUpdate = z.object({
  settings: EditRecipe,
  history: EditHistoryStep.array().max(200),
  history_cursor: z.int().min(-1),
});
export type PhotoEditUpdate = z.infer<typeof PhotoEditUpdate>;

/**
 * `Photo.edit`: the edited picture of a photo with a rendition. Clients add `?v=<version>` to a
 * thumbnail or full-size URL of an edited photo.
 */
export const PhotoEditSummary = z.object({
  version: z.int(),
  rendition: EditRendition,
  width: z.int(),
  height: z.int(),
});
export type PhotoEditSummary = z.infer<typeof PhotoEditSummary>;
