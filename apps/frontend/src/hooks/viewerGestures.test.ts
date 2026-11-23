import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../util/defined.test-utils";
import {
  trackViewerGestures,
  type DragGesture,
  type GesturePoint,
  type PinchGesture,
  type WheelGesture,
} from "./viewerGestures";

let element: HTMLDivElement;
let clock = 0;
let stop: () => void;
const drags: DragGesture[] = [];
const dragEnds: DragGesture[] = [];
const pinches: PinchGesture[] = [];
const pinchEnds: PinchGesture[] = [];
const doubleTaps: GesturePoint[] = [];
const wheels: WheelGesture[] = [];
let wheelHandled = true;

beforeEach(() => {
  element = document.createElement("div");
  document.body.appendChild(element);
  clock = 0;
  wheelHandled = true;
  stop = trackViewerGestures(
    element,
    () => ({
      onDrag: drag => drags.push(drag),
      onDragEnd: drag => dragEnds.push(drag),
      onPinch: pinch => pinches.push(pinch),
      onPinchEnd: pinch => pinchEnds.push(pinch),
      onDoubleTap: point => doubleTaps.push(point),
      onWheel: wheel => {
        wheels.push(wheel);
        return wheelHandled;
      },
    }),
    () => clock
  );
});

afterEach(() => {
  stop();
  element.remove();
  for (const list of [drags, dragEnds, pinches, pinchEnds, doubleTaps, wheels]) list.length = 0;
});

function pointer(type: string, id: number, x: number, y: number, at = clock, target: Element = element) {
  clock = at;
  target.dispatchEvent(
    new PointerEvent(type, {
      pointerId: id,
      clientX: x,
      clientY: y,
      pointerType: "touch",
      bubbles: true,
      cancelable: true,
    })
  );
}

describe("trackViewerGestures", () => {
  it("starts a drag only past the tap slop and locks it to the axis it started on", () => {
    pointer("pointerdown", 1, 100, 100, 0);
    pointer("pointermove", 1, 104, 101, 10);
    expect(drags).toEqual([]);

    pointer("pointermove", 1, 130, 110, 20);
    pointer("pointermove", 1, 140, 160, 30);

    expect(drags.map(drag => drag.axis)).toEqual(["x", "x"]);
    expect(defined(drags[0]).first).toBe(true);
    expect(defined(drags[1]).first).toBe(false);
    expect(defined(drags[1]).movement).toEqual({ x: 40, y: 60 });
    expect(defined(drags[1]).delta).toEqual({ x: 10, y: 50 });
  });

  it("ends a drag with the velocity of its last 100 ms", () => {
    pointer("pointerdown", 1, 300, 100, 0);
    pointer("pointermove", 1, 290, 100, 100);
    pointer("pointermove", 1, 200, 100, 250);
    pointer("pointermove", 1, 100, 100, 300);
    pointer("pointerup", 1, 100, 100, 300);

    const end = defined(dragEnds[0]);
    expect(end.movement.x).toBe(-200);
    expect(end.velocity.x).toBeCloseTo(-2);
  });

  it("ends with no velocity when the finger stopped before it lifted", () => {
    pointer("pointerdown", 1, 300, 100, 0);
    pointer("pointermove", 1, 250, 100, 10);
    pointer("pointerup", 1, 250, 100, 400);

    expect(defined(dragEnds[0]).velocity).toEqual({ x: 0, y: 0 });
  });

  it("reports two quick taps in one place as a double tap, and a slow pair as nothing", () => {
    pointer("pointerdown", 1, 50, 50, 0);
    pointer("pointerup", 1, 50, 50, 40);
    pointer("pointerdown", 2, 55, 52, 200);
    pointer("pointerup", 2, 55, 52, 240);
    expect(doubleTaps).toEqual([{ x: 55, y: 52 }]);

    pointer("pointerdown", 3, 50, 50, 1000);
    pointer("pointerup", 3, 50, 50, 1040);
    pointer("pointerdown", 4, 50, 50, 1500);
    pointer("pointerup", 4, 50, 50, 1540);
    expect(doubleTaps).toHaveLength(1);
  });

  it("pinches around the fingers' midpoint, and a second finger ends the drag the first began", () => {
    pointer("pointerdown", 1, 100, 100, 0);
    pointer("pointermove", 1, 120, 100, 10);
    pointer("pointerdown", 2, 220, 100, 20);
    expect(dragEnds).toHaveLength(1);

    pointer("pointermove", 2, 320, 100, 30);
    pointer("pointermove", 1, 70, 100, 40);

    const last = defined(pinches.at(-1));
    expect(defined(pinches[0]).first).toBe(true);
    expect(last.startOrigin).toEqual({ x: 170, y: 100 });
    expect(last.scale).toBeCloseTo(2.5);
    expect(last.origin).toEqual({ x: 195, y: 100 });

    pointer("pointerup", 2, 320, 100, 50);
    expect(pinchEnds).toHaveLength(1);
    pointer("pointermove", 1, 60, 100, 60);
    expect(drags.at(-1)?.movement).toEqual({ x: -10, y: 0 });
  });

  it("leaves a pointer on an element that owns its gestures alone", () => {
    const owner = document.createElement("div");
    owner.setAttribute("data-own-gesture", "");
    const glyph = document.createElement("span");
    owner.appendChild(glyph);
    element.appendChild(owner);

    pointer("pointerdown", 1, 10, 10, 0, glyph);
    pointer("pointermove", 1, 200, 10, 10, glyph);
    pointer("pointerup", 1, 200, 10, 20, glyph);

    expect(drags).toEqual([]);
    expect(dragEnds).toEqual([]);
  });

  it("hands the wheel over in pixels and cancels the page scroll only when it was used", () => {
    const lines = new WheelEvent("wheel", {
      deltaY: 3,
      deltaMode: WheelEvent.DOM_DELTA_LINE,
      ctrlKey: true,
      cancelable: true,
    });
    element.dispatchEvent(lines);
    expect(defined(wheels[0]).deltaY).toBe(48);
    expect(defined(wheels[0]).ctrlKey).toBe(true);
    expect(lines.defaultPrevented).toBe(true);

    wheelHandled = false;
    const ignored = new WheelEvent("wheel", { deltaY: 100, cancelable: true });
    element.dispatchEvent(ignored);
    expect(ignored.defaultPrevented).toBe(false);
  });

  it("stops listening once disposed", () => {
    stop();
    pointer("pointerdown", 1, 0, 0, 0);
    pointer("pointermove", 1, 100, 0, 10);
    expect(drags).toEqual([]);
    stop = vi.fn<() => void>();
  });
});
