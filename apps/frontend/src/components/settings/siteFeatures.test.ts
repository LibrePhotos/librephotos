import { describe, expect, it } from "vitest";
import { downloadPercent, envVariable, FEATURE_ROWS, modelStatus } from "./siteFeatures";

const download = (status: string) => ({ id: 1, status, progress_current: 3, progress_target: 12 });

describe("siteFeatures", () => {
  it("posts each switch under its own flat field", () => {
    for (const row of FEATURE_ROWS) {
      expect(row.update(false)).toEqual({ [`${row.name}_enabled`]: false });
    }
  });

  it("names the environment variable that locks a feature", () => {
    expect(envVariable("image_captioning")).toBe("FEATURE_IMAGE_CAPTIONING");
    expect(envVariable("video_previews")).toBe("FEATURE_VIDEO_PREVIEWS");
  });

  it("lists the animated previews right under Videos, as its sub-switch", () => {
    const names = FEATURE_ROWS.map(row => row.name);
    expect(names.indexOf("video_previews")).toBe(names.indexOf("video") + 1);
    expect(FEATURE_ROWS.find(row => row.name === "video_previews")?.parent).toBe("video");
  });

  it("shows no model line for a feature that is off or needs no model", () => {
    expect(modelStatus({ enabled: false, locked: false, model_ready: false }, download("running"))).toBe("none");
    expect(modelStatus({ enabled: true, locked: false, model_ready: null }, download("running"))).toBe("none");
  });

  it("reads the model line from the model and the newest download", () => {
    const missing = { enabled: true, locked: false, model_ready: false };
    expect(modelStatus({ ...missing, model_ready: true }, download("failed"))).toBe("ready");
    expect(modelStatus(missing, download("running"))).toBe("downloading");
    expect(modelStatus(missing, download("failed"))).toBe("failed");
    expect(modelStatus(missing, download("cancelled"))).toBe("missing");
    expect(modelStatus(missing, null)).toBe("missing");
  });

  it("gives the download's progress in percent, 0 before the job knows its size", () => {
    expect(downloadPercent(download("running"))).toBe(25);
    expect(downloadPercent({ ...download("running"), progress_target: 0 })).toBe(0);
    expect(downloadPercent({ ...download("running"), progress_current: 20 })).toBe(100);
  });
});
