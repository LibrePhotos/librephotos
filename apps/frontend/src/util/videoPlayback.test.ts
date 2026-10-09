import { afterEach, describe, expect, it, vi } from "vitest";
import { convertedUrl, needsConversion } from "./videoPlayback";

const HEVC_MAIN_10 = 'video/mp4; codecs="hvc1.2.4.L120.90"';

describe("needsConversion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function browserSays(answer: CanPlayTypeResult) {
    return vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue(answer);
  }

  it("converts what the browser says it cannot play", () => {
    const canPlayType = browserSays("");
    expect(needsConversion(HEVC_MAIN_10)).toBe(true);
    expect(canPlayType).toHaveBeenCalledWith(HEVC_MAIN_10);
  });

  it("plays what the browser says it can", () => {
    browserSays("probably");
    expect(needsConversion(HEVC_MAIN_10)).toBe(false);
  });

  it("lets the browser try what it thinks it might play", () => {
    browserSays("maybe");
    expect(needsConversion(HEVC_MAIN_10)).toBe(false);
  });

  it("plays a video that was never probed as it is", () => {
    const canPlayType = browserSays("");
    expect(needsConversion(null)).toBe(false);
    expect(needsConversion(undefined)).toBe(false);
    expect(needsConversion("")).toBe(false);
    expect(canPlayType).not.toHaveBeenCalled();
  });
});

describe("convertedUrl", () => {
  it("asks for the conversion", () => {
    expect(convertedUrl("/media/photos/abc.mp4")).toBe("/media/photos/abc.mp4?transcode=1");
  });

  it("keeps a query the URL already has", () => {
    expect(convertedUrl("/media/photos/abc.mp4?v=2")).toBe("/media/photos/abc.mp4?v=2&transcode=1");
  });
});
