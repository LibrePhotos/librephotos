import React, { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { SWIPE_MS, useLightboxGestures } from "./useLightboxGestures";
import { useLightboxZoom, type LightboxZoom } from "./useLightboxZoom";

const STAGE = { width: 1000, height: 800 };
const PHOTO = { width: 1000, height: 600 };

type Probe = { zoom: LightboxZoom; swipedTo: string | null };
const probe: { current: Probe | null } = { current: null };
const onMoveNextRequest = vi.fn<() => void>();
const onMovePrevRequest = vi.fn<() => void>();

function Viewer({ src, nextSrc, prevSrc }: Readonly<{ src: string; nextSrc: string | null; prevSrc: string | null }>) {
  const media = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const mainSlide = useRef<HTMLDivElement>(null);
  const zoom = useLightboxZoom(src);
  const { swipedTo } = useLightboxGestures({
    mainSrc: src,
    media,
    track,
    mainSlide,
    zoom,
    enabled: true,
    zoomable: true,
    quarterTurned: false,
    nextSrc,
    prevSrc,
    onMoveNextRequest,
    onMovePrevRequest,
  });
  probe.current = { zoom, swipedTo };
  return (
    <div ref={media} data-testid="media">
      <div ref={track} data-testid="track">
        <div ref={mainSlide} data-testid="main">
          <img alt="" />
        </div>
      </div>
    </div>
  );
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => STAGE.width });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => STAGE.height });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => PHOTO.width });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => PHOTO.height });
  HTMLElement.prototype.getBoundingClientRect = () => new DOMRect(0, 0, STAGE.width, STAGE.height);
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  onMoveNextRequest.mockReset();
  onMovePrevRequest.mockReset();
});

const render = (src: string, nextSrc: string | null = "b", prevSrc: string | null = null) =>
  act(async () => root.render(<Viewer src={src} nextSrc={nextSrc} prevSrc={prevSrc} />));
const element = (testId: string) => defined(container.querySelector<HTMLElement>(`[data-testid="${testId}"]`));
const cssVar = (testId: string, name: string) => element(testId).style.getPropertyValue(name);
const current = () => defined(probe.current);

async function pointer(type: string, id: number, x: number, y = 400) {
  await act(async () => {
    element("media").dispatchEvent(
      new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, pointerType: "touch", bubbles: true })
    );
  });
}

async function swipe(from: number, to: number, steps: number, stepMs: number) {
  await pointer("pointerdown", 1, from);
  for (let step = 1; step <= steps; step += 1) {
    await act(async () => vi.advanceTimersByTime(stepMs));
    await pointer("pointermove", 1, from + ((to - from) * step) / steps);
  }
  await pointer("pointerup", 1, to);
}

describe("useLightboxGestures", () => {
  it("slides the next photo in on a long swipe, then steps without a snap back", async () => {
    await render("a");
    await swipe(800, 300, 5, 40);
    expect(cssVar("track", "--lb-swipe-x")).toBe("-1000px");
    expect(cssVar("track", "--lb-swipe-transition")).toContain(`${SWIPE_MS}ms`);
    expect(onMoveNextRequest).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(SWIPE_MS + 100));
    expect(onMoveNextRequest).toHaveBeenCalledTimes(1);
    await render("b", "c", "a");

    expect(cssVar("track", "--lb-swipe-x")).toBe("0px");
    expect(cssVar("track", "--lb-swipe-transition")).toBe("none");
    expect(current().swipedTo).toBe("b");
  });

  it("follows the finger, and springs back from a short slow swipe", async () => {
    await render("a");
    await pointer("pointerdown", 1, 500);
    await pointer("pointermove", 1, 440);
    expect(cssVar("track", "--lb-swipe-x")).toBe("-60px");
    expect(cssVar("track", "--lb-swipe-transition")).toBe("none");

    await act(async () => vi.advanceTimersByTime(500));
    await pointer("pointerup", 1, 440);
    await act(async () => vi.advanceTimersByTime(1000));

    expect(cssVar("track", "--lb-swipe-x")).toBe("0px");
    expect(onMoveNextRequest).not.toHaveBeenCalled();
  });

  it("steps on a short fling", async () => {
    await render("a");
    await swipe(500, 420, 4, 10);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(onMoveNextRequest).toHaveBeenCalledTimes(1);
  });

  it("resists at the last photo and stays there", async () => {
    await render("a", null);
    await swipe(800, 300, 5, 40);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(onMoveNextRequest).not.toHaveBeenCalled();
    expect(cssVar("track", "--lb-swipe-x")).toBe("0px");
  });

  it("slides back when the step is refused (an unsaved edit asks first)", async () => {
    await render("a");
    await swipe(800, 300, 5, 40);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(onMoveNextRequest).toHaveBeenCalledTimes(1);
    expect(cssVar("track", "--lb-swipe-x")).toBe("0px");
    expect(cssVar("track", "--lb-swipe-transition")).not.toBe("none");
  });

  it("zooms around a double tap, and a drag then pans instead of swiping", async () => {
    await render("a");
    await pointer("pointerdown", 1, 300, 400);
    await pointer("pointerup", 1, 300, 400);
    await act(async () => vi.advanceTimersByTime(100));
    await pointer("pointerdown", 2, 300, 400);
    await pointer("pointerup", 2, 300, 400);

    expect(current().zoom.view).toEqual({ scale: 2, x: 200, y: 0 });
    expect(cssVar("main", "--lb-scale")).toBe("2");
    expect(cssVar("main", "--lb-x")).toBe("200px");

    await pointer("pointerdown", 3, 500, 400);
    await pointer("pointermove", 3, 450, 420);
    expect(cssVar("main", "--lb-x")).toBe("150px");
    expect(cssVar("main", "--lb-zoom-transition")).toBe("none");
    expect(current().zoom.view.x).toBe(200);
    await pointer("pointerup", 3, 450, 420);

    expect(current().zoom.view).toEqual({ scale: 2, x: 150, y: 20 });
    expect(cssVar("track", "--lb-swipe-x")).toBe("");
  });

  it("pinches around the fingers and springs back to fitted from a small pinch", async () => {
    await render("a");
    await pointer("pointerdown", 1, 400);
    await pointer("pointerdown", 2, 600);
    await pointer("pointermove", 2, 800);
    expect(cssVar("main", "--lb-scale")).toBe("2");

    await pointer("pointerup", 2, 800);
    await pointer("pointerup", 1, 400);
    expect(current().zoom.view.scale).toBe(2);

    await pointer("pointerdown", 1, 400);
    await pointer("pointerdown", 2, 600);
    await pointer("pointermove", 2, 450);
    await pointer("pointerup", 2, 450);
    await pointer("pointerup", 1, 400);
    expect(current().zoom.view).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("zooms with the wheel around the pointer, and keeps the page from scrolling", async () => {
    await render("a");
    const wheel = new WheelEvent("wheel", { deltaY: -200, clientX: 500, clientY: 400, cancelable: true });
    await act(async () => element("media").dispatchEvent(wheel));

    expect(wheel.defaultPrevented).toBe(true);
    expect(Number(cssVar("main", "--lb-scale"))).toBeGreaterThan(1);
    await act(async () => vi.advanceTimersByTime(200));
    expect(current().zoom.isMagnified).toBe(true);
  });

  it("shows the next photo unzoomed", async () => {
    await render("a");
    await act(async () => current().zoom.toggleZoom());
    expect(cssVar("main", "--lb-scale")).toBe("2");

    await render("b", "c", "a");

    expect(current().zoom.isMagnified).toBe(false);
    expect(cssVar("main", "--lb-scale")).toBe("1");
  });
});
