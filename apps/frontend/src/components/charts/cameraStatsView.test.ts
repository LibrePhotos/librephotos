import type { CameraStats } from "@librephotos/api-client";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { RANGE_FIELDS } from "../search/searchFilterRanges";
import { bucketSearch, cameraRows, exposureCharts, lensRows, rangeBars } from "./cameraStatsView";

const field = (id: string) => defined(RANGE_FIELDS.find(candidate => candidate.id === id));

const EMPTY: CameraStats = {
  cameras: [],
  lenses: [],
  iso: [],
  aperture: [],
  focal_length: [],
  focal_length_35mm: [],
  shutter_speed: [],
};

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("bucketSearch", () => {
  it("searches the bucket's own range on its field", () => {
    expect(bucketSearch({ label: "100", min: 100, max: 103, count: 2 }, field("iso"))).toEqual({
      iso_min: 100,
      iso_max: 103,
    });
    expect(bucketSearch({ label: "f/1.8", min: 1.69, max: 1.78, count: 3 }, field("aperture"))).toEqual({
      aperture_min: 1.69,
      aperture_max: 1.78,
    });
    expect(bucketSearch({ label: "4–5 mm", min: 4.25, max: 4.25, count: 1 }, field("focal"))).toEqual({
      focal_min: 4.25,
      focal_max: 4.25,
    });
    expect(bucketSearch({ label: "24–28 mm", min: 24, max: 26, count: 2 }, field("focal35"))).toEqual({
      focal35_min: 24,
      focal35_max: 26,
    });
    expect(bucketSearch({ label: "1/125", min: 1 / 125, max: 1 / 121, count: 2 }, field("shutter"))).toEqual({
      shutter_min: 1 / 125,
      shutter_max: 1 / 121,
    });
  });

  it("sends whole numbers where the server takes only those", () => {
    expect(bucketSearch({ label: "400", min: 400.0, max: 640.0000001, count: 1 }, field("iso"))).toEqual({
      iso_min: 400,
      iso_max: 640,
    });
  });
});

describe("rangeBars", () => {
  it("names each bar with its field and label", () => {
    const bars = rangeBars(
      [
        { label: "1/250", min: 0.004, max: 0.004, count: 5 },
        { label: "2 s", min: 2, max: 2, count: 1 },
      ],
      field("shutter"),
      i18n.t
    );
    expect(bars.map(bar => [bar.axis, bar.name, bar.count])).toEqual([
      ["1/250", "Shutter speed 1/250", 5],
      ["2 s", "Shutter speed 2 s", 1],
    ]);
    expect(bars[1]?.search).toEqual({ shutter_min: 2, shutter_max: 2 });
  });
});

describe("exposureCharts", () => {
  it("draws a chart for every exposure value the library has, in the panel's order", () => {
    const charts = exposureCharts(
      {
        ...EMPTY,
        shutter_speed: [{ label: "1/60", min: 1 / 60, max: 1 / 60, count: 1 }],
        iso: [
          { label: "100", min: 100, max: 100, count: 1 },
          { label: "400", min: 400, max: 400, count: 4 },
        ],
      },
      i18n.t
    );
    expect(charts.map(chart => chart.title)).toEqual(["ISO", "Shutter speed"]);
    expect(charts[0]?.summary).toBe(
      "ISO of your photos from 100 to 400, most often 400 (4 photos). Use the arrow keys to read each bar and Enter to search its photos."
    );
  });
});

describe("cameraRows", () => {
  it("searches a camera with its maker when every photo of it names one", () => {
    expect(
      cameraRows([{ label: "Apple iPhone 15 Pro", value: "iPhone 15 Pro", make: "Apple", count: 3 }])[0]?.search
    ).toEqual({ camera: "iPhone 15 Pro", make: "Apple" });
  });

  it("searches the model alone when the row counts it with any maker", () => {
    expect(cameraRows([{ label: "Dacia Phone", value: "Dacia Phone", make: "", count: 1 }])[0]?.search).toEqual({
      camera: "Dacia Phone",
    });
  });

  it("keeps two makers' cameras of the same name apart", () => {
    const rows = cameraRows([
      { label: "Canon EOS R5", value: "EOS R5", make: "Canon", count: 2 },
      { label: "Sony EOS R5", value: "EOS R5", make: "Sony", count: 1 },
    ]);
    expect(new Set(rows.map(row => row.key)).size).toBe(2);
  });
});

describe("lensRows", () => {
  it("searches the lens model", () => {
    expect(lensRows([{ label: "XF23mmF1.4 R", value: "XF23mmF1.4 R", count: 2 }])).toEqual([
      { key: "xf23mmf1.4 r", label: "XF23mmF1.4 R", count: 2, search: { lens: "XF23mmF1.4 R" } },
    ]);
  });
});
