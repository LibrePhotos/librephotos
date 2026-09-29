/**
 * The lightbox asks for a converted video only when this browser says it
 * cannot play the original -- HEVC in a Chrome without a hardware decoder plays
 * the sound over a black picture and reports no error, so waiting for a failure
 * is not enough there. Everything it can play is served as it is, at full
 * resolution, and falls back to a conversion only if it fails after all.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MediaDisplay } from "./MediaDisplay";

const player = vi.fn();

vi.mock("./VideoPlayer", () => ({
  VideoPlayer: (props: { url: string; fallbackUrl?: string }) => {
    player(props);
    return null;
  },
}));

vi.mock("../../api_client/apiClient", () => ({ serverAddress: "" }));

const HEVC = 'video/mp4; codecs="hvc1.2.4.L120.90"';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  player.mockClear();
  vi.restoreAllMocks();
});

async function renderVideo(photoDetails: object | null, type = "video") {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MediaDisplay
        id="abc"
        image_hash="abc"
        isMainContent
        type={type}
        faceLocation={null as never}
        handleDragStart={() => {}}
        photoDetails={photoDetails}
      />
    );
  });
  await act(async () => root.unmount());
  return player.mock.calls.at(-1)![0] as { url: string; fallbackUrl?: string };
}

describe("MediaDisplay video source", () => {
  it("asks for a conversion up front when the browser says it cannot play the video", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("");

    const props = await renderVideo({ video_playback_type: HEVC });

    expect(props.url).toBe("/media/photos/abc.mp4?transcode=1");
    expect(props.fallbackUrl).toBeUndefined();
  });

  it("plays the original when the browser can, with the conversion held in reserve", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");

    const props = await renderVideo({ video_playback_type: HEVC });

    expect(props.url).toBe("/media/photos/abc.mp4");
    expect(props.fallbackUrl).toBe("/media/photos/abc.mp4?transcode=1");
  });

  it("plays a video that has not been probed yet as it is", async () => {
    const canPlayType = vi.spyOn(HTMLMediaElement.prototype, "canPlayType");

    const props = await renderVideo({ video_playback_type: null });

    expect(props.url).toBe("/media/photos/abc.mp4");
    expect(props.fallbackUrl).toBe("/media/photos/abc.mp4?transcode=1");
    expect(canPlayType).not.toHaveBeenCalled();
  });

  it("leaves a Live Photo's motion clip alone", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("");

    const props = await renderVideo({ video_playback_type: HEVC }, "embedded");

    expect(props.url).toBe("/media/embedded_media/abc");
    expect(props.fallbackUrl).toBeUndefined();
  });
});
