export type GesturePoint = Readonly<{ x: number; y: number }>;

export type DragGesture = Readonly<{
  first: boolean;
  axis: "x" | "y";
  point: GesturePoint;
  movement: GesturePoint;
  delta: GesturePoint;
  velocity: GesturePoint;
  target: EventTarget | null;
}>;

export type PinchGesture = Readonly<{
  first: boolean;
  scale: number;
  origin: GesturePoint;
  startOrigin: GesturePoint;
}>;

export type WheelGesture = Readonly<{ point: GesturePoint; deltaX: number; deltaY: number; ctrlKey: boolean }>;

export type ViewerGestureHandlers = Partial<{
  onDrag: (drag: DragGesture) => void;
  onDragEnd: (drag: DragGesture) => void;
  onPinch: (pinch: PinchGesture) => void;
  onPinchEnd: (pinch: PinchGesture) => void;
  onWheel: (wheel: WheelGesture) => boolean;
  onDoubleTap: (point: GesturePoint) => void;
}>;

const TAP_SLOP_PX = 8;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP_PX = 30;
const VELOCITY_WINDOW_MS = 100;
const WHEEL_LINE_PX = 16;
const OWN_GESTURE = "[data-own-gesture]";

type Sample = Readonly<{ time: number; point: GesturePoint }>;
type Tracked = { id: number; start: GesturePoint; point: GesturePoint; samples: Sample[] };
type DragTrack = { axis: "x" | "y"; last: GesturePoint; state: DragGesture | null; target: EventTarget | null };
type PinchTrack = { startDistance: number; startOrigin: GesturePoint; state: PinchGesture | null };

const pointOf = (event: { clientX: number; clientY: number }): GesturePoint => ({ x: event.clientX, y: event.clientY });
const minus = (a: GesturePoint, b: GesturePoint): GesturePoint => ({ x: a.x - b.x, y: a.y - b.y });
const distance = (a: GesturePoint, b: GesturePoint) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: GesturePoint, b: GesturePoint): GesturePoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function capture(element: HTMLElement, pointerId: number) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    return;
  }
}

function release(element: HTMLElement, pointerId: number) {
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  } catch {
    return;
  }
}

export function ownsGesture(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(OWN_GESTURE) !== null;
}

function velocityOf(samples: readonly Sample[]): GesturePoint {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last || last.time <= first.time) return { x: 0, y: 0 };
  const elapsed = last.time - first.time;
  return { x: (last.point.x - first.point.x) / elapsed, y: (last.point.y - first.point.y) / elapsed };
}

export function trackViewerGestures(
  element: HTMLElement,
  handlers: () => ViewerGestureHandlers,
  now: () => number = () => performance.now()
): () => void {
  const pointers = new Map<number, Tracked>();
  let drag: DragTrack | null = null;
  let pinch: PinchTrack | null = null;
  let tapping = false;
  let lastTap: Sample | null = null;

  const record = (tracked: Tracked, point: GesturePoint) => {
    const time = now();
    tracked.point = point;
    tracked.samples = [...tracked.samples.filter(sample => time - sample.time <= VELOCITY_WINDOW_MS), { time, point }];
  };

  const pair = (): [Tracked, Tracked] | null => {
    const [a, b] = [...pointers.values()];
    return a && b ? [a, b] : null;
  };

  const endDrag = (released?: Tracked) => {
    if (drag?.state) {
      handlers().onDragEnd?.(released ? { ...drag.state, velocity: velocityOf(released.samples) } : drag.state);
    }
    drag = null;
  };

  const startPinch = () => {
    const both = pair();
    if (!both) return;
    both.forEach(tracked => capture(element, tracked.id));
    pinch = {
      startDistance: Math.max(1, distance(both[0].point, both[1].point)),
      startOrigin: midpoint(both[0].point, both[1].point),
      state: null,
    };
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (ownsGesture(event.target)) return;
    const point = pointOf(event);
    pointers.set(event.pointerId, { id: event.pointerId, start: point, point, samples: [{ time: now(), point }] });
    if (pointers.size === 1) {
      tapping = true;
      drag = null;
      return;
    }
    tapping = false;
    endDrag();
    if (pointers.size === 2) startPinch();
  };

  const moveDrag = (tracked: Tracked, target: EventTarget | null) => {
    const movement = minus(tracked.point, tracked.start);
    if (!drag) {
      if (Math.hypot(movement.x, movement.y) < TAP_SLOP_PX) return;
      tapping = false;
      capture(element, tracked.id);
      drag = {
        axis: Math.abs(movement.x) >= Math.abs(movement.y) ? "x" : "y",
        last: tracked.start,
        state: null,
        target,
      };
    }
    const state: DragGesture = {
      first: drag.state === null,
      axis: drag.axis,
      point: tracked.point,
      movement,
      delta: minus(tracked.point, drag.last),
      velocity: velocityOf(tracked.samples),
      target: drag.target,
    };
    drag.last = tracked.point;
    drag.state = state;
    handlers().onDrag?.(state);
  };

  const movePinch = () => {
    const both = pair();
    if (!pinch || !both) return;
    const state: PinchGesture = {
      first: pinch.state === null,
      scale: distance(both[0].point, both[1].point) / pinch.startDistance,
      origin: midpoint(both[0].point, both[1].point),
      startOrigin: pinch.startOrigin,
    };
    pinch.state = state;
    handlers().onPinch?.(state);
  };

  const onPointerMove = (event: PointerEvent) => {
    const tracked = pointers.get(event.pointerId);
    if (!tracked) return;
    record(tracked, pointOf(event));
    if (pinch) movePinch();
    else if (pointers.size === 1) moveDrag(tracked, event.target);
  };

  const tap = (point: GesturePoint) => {
    const time = now();
    if (lastTap && time - lastTap.time <= DOUBLE_TAP_MS && distance(lastTap.point, point) <= DOUBLE_TAP_SLOP_PX) {
      lastTap = null;
      handlers().onDoubleTap?.(point);
      return;
    }
    lastTap = { time, point };
  };

  const endPinch = () => {
    if (pinch?.state) handlers().onPinchEnd?.(pinch.state);
    pinch = null;
    pointers.forEach(rest => {
      rest.start = rest.point;
      rest.samples = [{ time: now(), point: rest.point }];
    });
  };

  const onPointerEnd = (event: PointerEvent) => {
    const tracked = pointers.get(event.pointerId);
    if (!tracked) return;
    record(tracked, pointOf(event));
    pointers.delete(event.pointerId);
    release(element, event.pointerId);
    if (pinch) {
      if (pointers.size >= 2) startPinch();
      else endPinch();
      return;
    }
    if (drag) {
      endDrag(tracked);
      return;
    }
    if (tapping && event.type === "pointerup" && pointers.size === 0) tap(tracked.point);
    tapping = false;
  };

  const onWheel = (event: WheelEvent) => {
    if (ownsGesture(event.target)) return;
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_PX : 1;
    const handled = handlers().onWheel?.({
      point: pointOf(event),
      deltaX: event.deltaX * unit,
      deltaY: event.deltaY * unit,
      ctrlKey: event.ctrlKey,
    });
    if (handled) event.preventDefault();
  };

  const preventNativeZoom = (event: Event) => event.preventDefault();

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerEnd);
  element.addEventListener("pointercancel", onPointerEnd);
  element.addEventListener("wheel", onWheel, { passive: false });
  element.addEventListener("gesturestart", preventNativeZoom);
  return () => {
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", onPointerEnd);
    element.removeEventListener("pointercancel", onPointerEnd);
    element.removeEventListener("wheel", onWheel);
    element.removeEventListener("gesturestart", preventNativeZoom);
  };
}
