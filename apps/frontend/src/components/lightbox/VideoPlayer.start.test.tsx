/**
 * Opening a video at the moment a face appears (#2762): the player starts a second before the
 * face's `video_time` once the metadata is in, says so, and offers to play from the start. A
 * stream that cannot seek says that instead of silently playing from 0:00.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { createLightboxCommands, LightboxCommandsContext } from "./lightboxCommands";
import { VideoPlayer } from "./VideoPlayer";
import type { VideoStart } from "./videoStart";

const lightbox = createLightboxCommands();

vi.mock("../../api_client/auth/hooks", () => ({
  useAccessToken: () => ({ data: { access: { user_id: "1", name: "dotan", is_admin: false } } }),
}));

vi.mock("../../util/util", () => ({ copyToClipboard: () => {} }));

vi.mock("../../api_client/media", () => ({
  useMediaDiagnosticsQuery: () => ({ data: undefined }),
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
});

/** A playhead, a seekable window and a ready state, which jsdom's `<video>` lacks. */
function stubMedia(video: HTMLVideoElement, ranges: [number, number][], readyState = 1) {
  let time = 0;
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => time,
    set: (value: number) => {
      time = value;
    },
  });
  Object.defineProperty(video, "seekable", {
    configurable: true,
    get: () => ({
      length: ranges.length,
      start: (index: number) => defined(ranges[index])[0],
      end: (index: number) => defined(ranges[index])[1],
    }),
  });
  let state = readyState;
  Object.defineProperty(video, "readyState", { configurable: true, get: () => state });
  return {
    at: () => time,
    loadMetadata: async () => {
      state = 1;
      await act(async () => {
        video.dispatchEvent(new Event("loadedmetadata"));
      });
    },
  };
}

async function renderPlayer(start?: VideoStart) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <LightboxCommandsContext.Provider value={lightbox}>
          <VideoPlayer url="/media/video/abc.mp4" height="80vh" controls playing={false} start={start} />
        </LightboxCommandsContext.Provider>
      </MantineProvider>
    );
  });
  const unmount = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  return { container, video: defined(container.querySelector("video")), unmount };
}

describe("VideoPlayer start time", () => {
  it("starts a second before the face once the metadata is in, and says where", async () => {
    const { container, video, unmount } = await renderPlayer({ seconds: 42, name: "Anna" });
    const media = stubMedia(video, [[0, 151]], 0);

    expect(media.at()).toBe(0);
    await media.loadMetadata();

    expect(media.at()).toBe(41);
    const note = defined(container.querySelector('[role="status"]'));
    expect(note.textContent).toContain("lightbox.videostart.startednamed");
    await unmount();
  });

  it("plays from the start when asked, and the note goes", async () => {
    const { container, video, unmount } = await renderPlayer({ seconds: 42 });
    const media = stubMedia(video, [[0, 151]], 0);
    await media.loadMetadata();
    expect(container.textContent).toContain("lightbox.videostart.started");

    const button = defined(
      [...container.querySelectorAll("button")].find(element => element.textContent === "lightbox.videostart.fromstart")
    );
    await act(async () => button.click());

    expect(media.at()).toBe(0);
    expect(container.querySelector('[role="status"]')).toBeNull();
    await unmount();
  });

  it("says a stream that cannot seek plays from the start instead of pretending", async () => {
    const { container, video, unmount } = await renderPlayer({ seconds: 42, name: "Anna" });
    const media = stubMedia(video, [], 0);
    await media.loadMetadata();

    expect(media.at()).toBe(0);
    expect(container.textContent).toContain("lightbox.videostart.unseekablenamed");
    expect(container.textContent).not.toContain("lightbox.videostart.fromstart");
    await unmount();
  });

  it("starts at 0:00 with no note for a face on the first frame", async () => {
    const { container, video, unmount } = await renderPlayer();
    const media = stubMedia(video, [[0, 151]], 0);
    await media.loadMetadata();

    expect(media.at()).toBe(0);
    expect(container.querySelector('[role="status"]')).toBeNull();
    await unmount();
  });

  it("jumps to a face when its time button asks, now or once the metadata is in", async () => {
    const { video, unmount } = await renderPlayer();
    const media = stubMedia(video, [[0, 151]], 0);

    await act(async () => lightbox.emit("seekTo", 80, "Ben"));
    expect(media.at()).toBe(0);
    await media.loadMetadata();
    expect(media.at()).toBe(79);

    await act(async () => lightbox.emit("seekTo", 0.5, ""));
    expect(media.at()).toBe(0);
    await unmount();
  });
});
