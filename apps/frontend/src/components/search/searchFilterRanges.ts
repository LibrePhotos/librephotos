// The number ranges of the search filters: each one's URL keys, label, unit and presets.

type RangePreset = Readonly<{ min?: number; max?: number }>;

export type RangeField = Readonly<{
  id: "iso" | "aperture" | "focal" | "focal35" | "shutter";
  min: "iso_min" | "aperture_min" | "focal_min" | "focal35_min" | "shutter_min";
  max: "iso_max" | "aperture_max" | "focal_max" | "focal35_max" | "shutter_max";
  labelKey:
    | "searchfilter.range.iso"
    | "searchfilter.range.aperture"
    | "searchfilter.range.focal"
    | "searchfilter.range.focal35"
    | "searchfilter.range.shutter";
  unit: "plain" | "fnumber" | "mm" | "seconds";
  /** The server takes whole numbers only (ISO, 35 mm focal length). */
  integer: boolean;
  /** One-click bands, where people think in bands. */
  presets: readonly RangePreset[];
}>;

export const RANGE_FIELDS: readonly RangeField[] = [
  {
    id: "iso",
    min: "iso_min",
    max: "iso_max",
    labelKey: "searchfilter.range.iso",
    unit: "plain",
    integer: true,
    presets: [{ max: 400 }, { min: 400, max: 1600 }, { min: 1600, max: 6400 }, { min: 6400 }],
  },
  {
    id: "aperture",
    min: "aperture_min",
    max: "aperture_max",
    labelKey: "searchfilter.range.aperture",
    unit: "fnumber",
    integer: false,
    presets: [],
  },
  {
    id: "focal",
    min: "focal_min",
    max: "focal_max",
    labelKey: "searchfilter.range.focal",
    unit: "mm",
    integer: false,
    presets: [],
  },
  {
    id: "focal35",
    min: "focal35_min",
    max: "focal35_max",
    labelKey: "searchfilter.range.focal35",
    unit: "mm",
    integer: true,
    presets: [{ max: 24 }, { min: 24, max: 70 }, { min: 70 }],
  },
  {
    id: "shutter",
    min: "shutter_min",
    max: "shutter_max",
    labelKey: "searchfilter.range.shutter",
    unit: "seconds",
    integer: false,
    presets: [{ max: 1 / 500 }, { min: 1 / 500, max: 1 / 60 }, { min: 1 / 60, max: 1 }, { min: 1 }],
  },
];
