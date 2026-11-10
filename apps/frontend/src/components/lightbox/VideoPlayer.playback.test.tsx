/**
 * The player's load, probe and fallback as one state per video: a new video starts loading in the
 * very render that shows it, so nothing of the last video's failure reaches it, and a probe that
 * answers for a video no longer shown changes nothing.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { VideoPlayer } from "./VideoPlayer";

const diagnosticsEnabled = vi.fn<(mediaHash: string | undefined, enabled: boolean) => void>();

vi.mock("../../api_client/auth/hooks", () => ({
  useAccessToken: () => ({ data: { access: { user_id: "1", name: "admin", is_admin: true } } }),
}));
vi.mock("../../util/util", () => ({
  copyToClipboard: () => {},
  copyText: () => Promise.resolve(true),
}));
vi.mock("../../api_client/media", () => ({
  useMediaDiagnosticsQuery: (mediaHash: string | undefined, enabled: boolean) => {
    diagnosticsEnabled(mediaHash, enabled);
    return { data: undefined };
  },
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

afterEach(() => {
  vi.unstubAllGlobals();
  diagnosticsEnabled.mockClear();
});

type Answer = { status: number };

/** Every HEAD probe waits until the test answers it. */
function heldProbes() {
  const pending: ((answer: Answer) => void)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise(resolve => {
          pending.push(({ status }) => resolve({ ok: status < 300, status, headers: { get: () => null } }));
        })
    )
  );
  return {
    answer: async (index: number, status: number) => {
      await act(async () => {
        defined(pending[index])({ status });
        await Promise.resolve();
        await Promise.resolve();
      });
    },
  };
}

type Props = { url: string; mediaHash: string; fallbackUrl?: string; onUnplayable?: () => void };

async function renderPlayer(initial: Props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (props: Props) =>
    act(async () => {
      root.render(
        <MantineProvider>
          <VideoPlayer {...props} height="80vh" controls playing={false} />
        </MantineProvider>
      );
    });
  await render(initial);
  return {
    container,
    render,
    fail: () =>
      act(async () => {
        defined(container.querySelector("video")).dispatchEvent(new Event("error"));
      }),
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

const errorPanel = (container: HTMLElement) => container.querySelector(".mantine-Alert-root");

describe("VideoPlayer moving to another video", () => {
  it("never renders the last video's failure against the next one", async () => {
    const probes = heldProbes();
    const player = await renderPlayer({ url: "/media/video/a", mediaHash: "a" });
    await player.fail();
    await probes.answer(0, 403);
    expect(diagnosticsEnabled).toHaveBeenLastCalledWith("a", true);

    await player.render({ url: "/media/video/b", mediaHash: "b" });

    expect(diagnosticsEnabled).not.toHaveBeenCalledWith("b", true);
    expect(errorPanel(player.container)).toBeNull();
    expect(defined(player.container.querySelector("video")).getAttribute("src")).toBe("/media/video/b");
    await player.unmount();
  });

  it("ignores a probe that answers for the video shown before", async () => {
    const probes = heldProbes();
    const player = await renderPlayer({ url: "/media/video/a", mediaHash: "a" });
    await player.fail();

    await player.render({ url: "/media/video/b", mediaHash: "b" });
    await probes.answer(0, 404);

    expect(errorPanel(player.container)).toBeNull();
    await player.unmount();
  });
});

describe("VideoPlayer reporting a video that cannot play", () => {
  it("says so once, after the probe, and not while it falls back to the conversion", async () => {
    const probes = heldProbes();
    const onUnplayable = vi.fn<() => void>();
    const player = await renderPlayer({
      url: "/media/video/a",
      mediaHash: "a",
      fallbackUrl: "/media/video/a?transcode=1",
      onUnplayable,
    });

    await player.fail();
    await probes.answer(0, 200);
    expect(onUnplayable).not.toHaveBeenCalled();
    expect(defined(player.container.querySelector("video")).getAttribute("src")).toBe("/media/video/a?transcode=1");

    await player.fail();
    expect(onUnplayable).not.toHaveBeenCalled();
    await probes.answer(1, 200);

    expect(errorPanel(player.container)).not.toBeNull();
    expect(onUnplayable).toHaveBeenCalledOnce();
    await player.unmount();
  });
});
