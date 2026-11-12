import type { EditHistoryStep } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import i18n from "../../../i18n";
import { historyLabel } from "./historyLabel";

const t = i18n.t.bind(i18n);
const step = (fields: Partial<EditHistoryStep>): EditHistoryStep => ({
  action: "set",
  at: "2026-11-12T09:30:00Z",
  settings: { version: 1 },
  ...fields,
});

describe("historyLabel", () => {
  it("names a set step by its control and formatted value", () => {
    expect(historyLabel(step({ control: "light.exposure", value: 0.35 }), t)).toBe("Exposure +0.35");
    expect(historyLabel(step({ control: "light.contrast", value: -12 }), t)).toBe("Contrast -12");
    expect(historyLabel(step({ control: "grain.amount", value: 30 }), t)).toBe("Grain 30");
    expect(historyLabel(step({ control: "mixer.aqua.sat", value: 20 }), t)).toBe("Aqua saturation +20");
    expect(historyLabel(step({ control: "bw_mix.red", value: -5 }), t)).toBe("B&W Red -5");
    expect(historyLabel(step({ control: "grading.shadows.hue", value: 210 }), t)).toBe("Shadows color");
    expect(historyLabel(step({ control: "grading.highlights.lum", value: 8 }), t)).toBe("Highlights luminance +8");
  });

  it("names the other controls", () => {
    expect(historyLabel(step({ control: "curve.master" }), t)).toBe("Tone curve");
    expect(historyLabel(step({ control: "curve.blue" }), t)).toBe("Tone curve: Blue");
    expect(historyLabel(step({ control: "color.treatment", value: "bw" }), t)).toBe("Black & white");
    expect(historyLabel(step({ control: "geometry.orientation", value: 90 }), t)).toBe("Rotate 90°");
    expect(historyLabel(step({ control: "geometry.aspect", value: "4:5" }), t)).toBe("Aspect ratio 4:5");
  });

  it("names the applied steps", () => {
    expect(historyLabel(step({ action: "crop" }), t)).toBe("Crop");
    expect(historyLabel(step({ action: "preset", value: "vivid" }), t)).toBe("Filter: Vivid");
    expect(historyLabel(step({ action: "preset", value: "original" }), t)).toBe("Filter: Original");
    expect(historyLabel(step({ action: "auto" }), t)).toBe("Auto");
    expect(historyLabel(step({ action: "paste" }), t)).toBe("Paste settings");
    expect(historyLabel(step({ action: "reset" }), t)).toBe("Reset");
    expect(historyLabel(step({ action: "import" }), t)).toBe("Import");
  });

  it("has a word for a step from a newer server", () => {
    expect(historyLabel(step({ control: "light.sparkle", value: 3 }), t)).toBe("Edit");
    expect(historyLabel(step({ action: "preset", value: "neon" }), t)).toBe("Filter: Edit");
  });
});
