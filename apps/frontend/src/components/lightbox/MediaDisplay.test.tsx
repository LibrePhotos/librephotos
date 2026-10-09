/**
 * The lightbox asks for a converted video only when this browser says it
 * cannot play the original -- HEVC in a Chrome without a hardware decoder plays
 * the sound over a black picture and reports no error, so waiting for a failure
 * is not enough there. Everything it can play is served as it is, at full
 * resolution, and falls back to a conversion only if it fails after all.
 * A photo's alt text is its caption or file name, never "Main Content".
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { MediaDisplay, type MediaDisplayDetails } from "./MediaDisplay";

type PlayerProps = { url: string; fallbackUrl?: string; convertible?: boolean; height: string; maxHeight?: string };

const player = vi.fn<(props: PlayerProps) => void>();

vi.mock("./VideoPlayer", () => ({
  VideoPlayer: (props: PlayerProps) => {
    player(props);
    return null;
  },
}));

vi.mock("../../api_client/apiClient", () => ({ serverAddress: "" }));

const HEVC = 'video/mp4; codecs="hvc1.2.4.L120.90"';

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  player.mockClear();
  vi.restoreAllMocks();
});

async function renderVideo(
  photoDetails: MediaDisplayDetails | null,
  type = "video",
  isPublic = false,
  fullHeight = false
) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MediaDisplay
        id="abc"
        image_hash="abc"
        isMainContent
        type={type}
        faceLocation={null}
        handleDragStart={() => {}}
        photoDetails={photoDetails}
        isPublic={isPublic}
        fullHeight={fullHeight}
      />
    );
  });
  await act(async () => root.unmount());
  return defined(player.mock.calls.at(-1))[0];
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
    expect(props.convertible).toBe(true);
  });

  it("plays a video that has not been probed yet as it is", async () => {
    const canPlayType = vi.spyOn(HTMLMediaElement.prototype, "canPlayType");

    const props = await renderVideo({ video_playback_type: null });

    expect(props.url).toBe("/media/photos/abc.mp4");
    expect(props.fallbackUrl).toBe("/media/photos/abc.mp4?transcode=1");
    expect(canPlayType).not.toHaveBeenCalled();
  });

  it("holds no conversion in reserve on a public page, where the server never converts", async () => {
    const props = await renderVideo(null, "video", true);

    expect(props.url).toBe("/media/photos/abc.mp4");
    expect(props.fallbackUrl).toBeUndefined();
  });

  it("leaves a Live Photo's motion clip alone", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("");

    const props = await renderVideo({ video_playback_type: HEVC }, "embedded");

    expect(props.url).toBe("/media/embedded_media/abc");
    expect(props.fallbackUrl).toBeUndefined();
    // Nothing converts it, so the player must not advise a conversion either.
    expect(props.convertible).toBe(false);
  });
});

describe("MediaDisplay video size", () => {
  it("fills the lightbox's box", async () => {
    const props = await renderVideo({ video_playback_type: null });

    expect(props.height).toBe("min(82vh, calc(100vh - 160px))");
    expect(props.maxHeight).toBeUndefined();
  });

  it("takes the video's own shape on the photo page, where there is no box to fill", async () => {
    const props = await renderVideo({ video_playback_type: null }, "video", false, true);

    // Not from the stored width and height: they ignore a phone video's rotation.
    expect(props.height).toBe("auto");
    expect(props.maxHeight).toBe("70vh");
  });
});

describe("MediaDisplay alt text", () => {
  async function renderPhotoAlt(photoDetails: MediaDisplayDetails | undefined) {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaDisplay
          id="abc"
          image_hash="abc"
          isMainContent
          type="photo"
          faceLocation={null}
          handleDragStart={() => {}}
          photoDetails={photoDetails}
        />
      );
    });
    const alt = container.querySelector("img")?.getAttribute("alt");
    await act(async () => root.unmount());
    return alt;
  }

  it("uses the caption, then the file name of a POSIX or Windows path", async () => {
    expect(await renderPhotoAlt({ captions_json: { user_caption: "Beach day" }, image_path: ["/p/a.jpg"] })).toBe(
      "Beach day"
    );
    expect(await renderPhotoAlt({ captions_json: {}, image_path: ["C:\\Photos\\IMG_1.jpg"] })).toBe("IMG_1.jpg");
  });

  it("falls back to a generic label without details", async () => {
    expect(await renderPhotoAlt(undefined)).toBe("phototile.photo");
  });
});
