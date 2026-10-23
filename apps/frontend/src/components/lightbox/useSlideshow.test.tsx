/** The lightbox's slideshow timer, moved out of ContentViewer unchanged. */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { useSlideshow } from "./useSlideshow";

const settings = vi.hoisted(() => ({ interval: undefined as number | undefined }));

vi.mock("../../api_client/user/hooks", () => ({
  useCurrentUserSelfDetailsQuery: () => ({
    data: settings.interval === undefined ? undefined : { slideshow_interval: settings.interval },
  }),
}));

type Args = Parameters<typeof useSlideshow>[0];
type Slideshow = ReturnType<typeof useSlideshow>;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  settings.interval = undefined;
});

async function renderSlideshow(overrides: Partial<Args> = {}) {
  const onMoveNextRequest = vi.fn<() => void>();
  const args: Args = {
    startSlideshow: true,
    isPublic: false,
    type: "photo",
    mainSrc: "a",
    nextSrc: "b",
    onMoveNextRequest,
    ...overrides,
  };
  let latest: Slideshow | undefined;
  function Probe(props: Args) {
    latest = useSlideshow(props);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const rerender = (next: Partial<Args>) => act(async () => root.render(<Probe {...args} {...next} />));
  await rerender({});
  return { current: () => defined(latest), rerender, onMoveNextRequest };
}

describe("useSlideshow", () => {
  it("moves on after the user's interval, with the ring filling up", async () => {
    settings.interval = 3;
    const show = await renderSlideshow();
    expect(show.current().slideshowInterval).toBe(3);

    await act(async () => vi.advanceTimersByTime(1500));
    expect(show.current().slideshowProgress).toBe(50);

    await act(async () => vi.advanceTimersByTime(1500));
    expect(show.onMoveNextRequest).toHaveBeenCalledOnce();
  });

  it("takes five seconds without a setting, and an interval picked in the lightbox over it", async () => {
    const show = await renderSlideshow();
    expect(show.current().slideshowInterval).toBe(5);

    await act(async () => show.current().setSlideshowInterval(10));

    expect(show.current().slideshowInterval).toBe(10);
  });

  it("stops after the last photo", async () => {
    const show = await renderSlideshow({ nextSrc: null });

    await act(async () => vi.advanceTimersByTime(5000));

    expect(show.onMoveNextRequest).not.toHaveBeenCalled();
    expect(show.current().isSlideshowActive).toBe(false);
  });

  it("waits for a video to end instead of a timer", async () => {
    const show = await renderSlideshow({ type: "video" });

    await act(async () => vi.advanceTimersByTime(10000));
    expect(show.onMoveNextRequest).not.toHaveBeenCalled();

    await act(async () => show.current().handleVideoEnded());
    expect(show.onMoveNextRequest).toHaveBeenCalledOnce();
  });

  it("stops when the last video ends", async () => {
    const show = await renderSlideshow({ type: "video", nextSrc: null });

    await act(async () => show.current().handleVideoEnded());

    expect(show.current().isSlideshowActive).toBe(false);
  });

  it("does nothing when a video ends outside a slideshow", async () => {
    const show = await renderSlideshow({ type: "video", startSlideshow: false });

    await act(async () => show.current().handleVideoEnded());

    expect(show.onMoveNextRequest).not.toHaveBeenCalled();
  });

  it("toggles, and starts the ring over on the next photo", async () => {
    const show = await renderSlideshow({ startSlideshow: false });

    await act(async () => show.current().toggleSlideshow());
    await act(async () => vi.advanceTimersByTime(2500));
    expect(show.current().slideshowProgress).toBe(50);

    await show.rerender({ mainSrc: "b" });

    expect(show.current().isSlideshowActive).toBe(true);
    expect(show.current().slideshowProgress).toBe(0);
  });
});
