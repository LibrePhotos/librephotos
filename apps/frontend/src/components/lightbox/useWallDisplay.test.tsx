import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { STORAGE_KEYS } from "../../util/storage";
import { useWallDisplay } from "./useWallDisplay";
import { DEFAULT_WALL_DISPLAY_SETTINGS, type WallDisplaySettings } from "./wallDisplay";

const wakeLock = vi.hoisted(() => ({ active: undefined as boolean | undefined }));

vi.mock("../../api_client/user/hooks", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: undefined }),
}));

vi.mock("../../hooks/useScreenWakeLock", () => ({
  useScreenWakeLock: (active: boolean) => {
    wakeLock.active = active;
  },
}));

type Args = Parameters<typeof useWallDisplay>[0];
type WallDisplay = ReturnType<typeof useWallDisplay>;

const roots: Root[] = [];

const NIGHT: Partial<WallDisplaySettings> = { sleepEnabled: true, sleepStart: "23:00", sleepEnd: "07:00" };

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.useRealTimers();
  localStorage.clear();
  wakeLock.active = undefined;
});

function clockAt(hours: number, minutes = 0) {
  vi.setSystemTime(new Date(2026, 5, 15, hours, minutes));
}

async function renderWallDisplay(settings: Partial<WallDisplaySettings>, overrides: Partial<Args> = {}) {
  localStorage.setItem(
    STORAGE_KEYS.lightboxWallDisplay,
    JSON.stringify({ ...DEFAULT_WALL_DISPLAY_SETTINGS, ...settings })
  );
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
  let latest: WallDisplay | undefined;
  let renders = 0;
  function Probe(props: Args) {
    latest = useWallDisplay(props);
    renders += 1;
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () => root.render(<Probe {...args} />));
  return { current: () => defined(latest), renders: () => renders, onMoveNextRequest };
}

describe("useWallDisplay", () => {
  it("goes to sleep at the start time and wakes at the end time", async () => {
    clockAt(22, 59);
    const wall = await renderWallDisplay(NIGHT, { type: "video" });
    expect(wall.current().asleep).toBe(false);

    await act(async () => vi.advanceTimersByTime(60_000));
    expect(wall.current().asleep).toBe(true);

    await act(async () => vi.advanceTimersByTime(8 * 60 * 60_000));
    expect(wall.current().asleep).toBe(false);
    expect(wall.current().slideshow.isSlideshowActive).toBe(true);
  });

  it("sleeps at once when the slideshow starts inside the window", async () => {
    clockAt(2);
    const wall = await renderWallDisplay(NIGHT);

    expect(wall.current().asleep).toBe(true);
  });

  it("holds the slideshow while asleep", async () => {
    clockAt(23, 30);
    const wall = await renderWallDisplay(NIGHT);

    await act(async () => vi.advanceTimersByTime(60_000));

    expect(wall.onMoveNextRequest).not.toHaveBeenCalled();
    expect(wall.current().slideshow.slideshowProgress).toBe(0);
  });

  it("re-renders only when sleep starts or ends", async () => {
    clockAt(12);
    const wall = await renderWallDisplay(NIGHT, { type: "video" });
    const before = wall.renders();

    await act(async () => vi.advanceTimersByTime(10 * 60_000));
    expect(wall.renders()).toBe(before);

    await act(async () => vi.advanceTimersByTime(11 * 60 * 60_000));
    expect(wall.current().asleep).toBe(true);
    expect(wall.renders()).toBe(before + 1);
  });

  it("does not sleep outside a slideshow", async () => {
    clockAt(2);
    const wall = await renderWallDisplay(NIGHT, { startSlideshow: false });

    expect(wall.current().asleep).toBe(false);
  });

  it("keeps the screen awake through the sleep window while the slideshow plays", async () => {
    clockAt(2);
    await renderWallDisplay(NIGHT);

    expect(wakeLock.active).toBe(true);
  });

  it("lets the screen go when the slideshow is off or keep awake is off", async () => {
    clockAt(12);
    await renderWallDisplay({}, { startSlideshow: false });
    expect(wakeLock.active).toBe(false);

    await renderWallDisplay({ keepAwake: false });
    expect(wakeLock.active).toBe(false);
  });

  it("hides the cursor only after it stays still, and shows it again when it moves", async () => {
    const wall = await renderWallDisplay({ hideCursor: true });
    expect(wall.current().stageProps["data-hidecursor"]).toBeUndefined();

    await act(async () => vi.advanceTimersByTime(2_999));
    expect(wall.current().stageProps["data-hidecursor"]).toBeUndefined();
    await act(async () => vi.advanceTimersByTime(1));
    expect(wall.current().stageProps["data-hidecursor"]).toBe(true);

    await act(async () => document.dispatchEvent(new Event("pointermove")));
    expect(wall.current().stageProps["data-hidecursor"]).toBeUndefined();
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(wall.current().stageProps["data-hidecursor"]).toBe(true);
  });

  it("leaves the cursor and the photo alone by default", async () => {
    const wall = await renderWallDisplay({});

    await act(async () => vi.advanceTimersByTime(5 * 60_000));

    expect(wall.current().stageProps["data-hidecursor"]).toBeUndefined();
    expect(wall.current().stageProps.style).toBeUndefined();
  });

  it("drifts the photo with burn-in protection on, but not while asleep", async () => {
    clockAt(12);
    const awake = await renderWallDisplay({ burnInProtection: true });
    expect(awake.current().stageProps.style?.transform).toBe("translate(0px, 0px)");

    clockAt(2);
    const asleep = await renderWallDisplay({ ...NIGHT, burnInProtection: true });
    expect(asleep.current().stageProps.style).toBeUndefined();
  });

  it("wakes on a tap by stopping the slideshow", async () => {
    clockAt(2);
    const wall = await renderWallDisplay(NIGHT);

    await act(async () => wall.current().wake());

    expect(wall.current().asleep).toBe(false);
    expect(wall.current().slideshow.isSlideshowActive).toBe(false);
  });
});
