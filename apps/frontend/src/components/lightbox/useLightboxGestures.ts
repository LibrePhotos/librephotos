import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useViewerGestures } from "../../hooks/useViewerGestures";
import type { DragGesture, GesturePoint } from "../../hooks/viewerGestures";
import {
  EDGE_RESISTANCE,
  isMagnifiedView,
  MIN_KEPT_SCALE,
  panView,
  pinchView,
  swipeTarget,
  toggledView,
  UNZOOMED,
  wheelScale,
  zoomAround,
  type BoxSize,
  type LightboxView,
} from "./lightboxView";
import type { LightboxZoom } from "./useLightboxZoom";

export const SWIPE_MS = 220;
const SWIPE_SETTLE_SLACK_MS = 80;
const WHEEL_COMMIT_MS = 150;
const ZOOM_TRANSITION = "transform 0.3s ease-out";

type Args = Readonly<{
  mainSrc: string;
  media: RefObject<HTMLDivElement | null>;
  track: RefObject<HTMLDivElement | null>;
  mainSlide: RefObject<HTMLDivElement | null>;
  zoom: LightboxZoom;
  enabled: boolean;
  zoomable: boolean;
  quarterTurned: boolean;
  nextSrc: string | null;
  prevSrc: string | null;
  onMoveNextRequest: () => void;
  onMovePrevRequest: () => void;
}>;

type Gesture = { kind: "pan" | "pinch"; start: LightboxView } | { kind: "swipe" } | null;

function writeView(element: HTMLElement | null, view: LightboxView, animated: boolean) {
  if (!element) return;
  element.style.setProperty("--lb-x", `${view.x}px`);
  element.style.setProperty("--lb-y", `${view.y}px`);
  element.style.setProperty("--lb-scale", String(view.scale));
  element.style.setProperty("--lb-zoom-transition", animated ? ZOOM_TRANSITION : "none");
}

function writeSwipe(element: HTMLElement | null, offset: number, animated: boolean) {
  if (!element) return;
  element.style.setProperty("--lb-swipe-x", `${offset}px`);
  element.style.setProperty("--lb-swipe-transition", animated ? `transform ${SWIPE_MS}ms ease-out` : "none");
}

export function useLightboxGestures(args: Args) {
  const { mainSrc, media, track, mainSlide, zoom, enabled } = args;
  const latest = useRef(args);
  const live = useRef<LightboxView>(zoom.view);
  const gesture = useRef<Gesture>(null);
  const leaving = useRef<string | null>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [swipedTo, setSwipedTo] = useState<string | null>(null);

  useEffect(() => {
    latest.current = args;
  });

  useLayoutEffect(() => {
    live.current = zoom.view;
    writeView(mainSlide.current, zoom.view, true);
  }, [zoom.view, mainSlide]);

  useLayoutEffect(() => {
    if (leaving.current === null || leaving.current === mainSrc) return;
    leaving.current = null;
    writeSwipe(track.current, 0, false);
  }, [mainSrc, track]);

  useEffect(
    () => () => {
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
    },
    []
  );

  const box = (): BoxSize => ({ width: media.current?.clientWidth ?? 0, height: media.current?.clientHeight ?? 0 });
  const content = (): BoxSize => {
    const image = mainSlide.current?.querySelector("img");
    const width = image?.offsetWidth ?? 0;
    const height = image?.offsetHeight ?? 0;
    return latest.current.quarterTurned ? { width: height, height: width } : { width, height };
  };
  const fromCenter = (point: GesturePoint): GesturePoint => {
    const rect = media.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: point.x - rect.left - rect.width / 2, y: point.y - rect.top - rect.height / 2 };
  };
  const show = (view: LightboxView) => {
    live.current = view;
    writeView(mainSlide.current, view, false);
  };
  const commit = (view: LightboxView) => {
    live.current = view;
    latest.current.zoom.setView(() => view);
  };

  const finishSwipe = (direction: -1 | 0 | 1) => {
    const { nextSrc, prevSrc, onMoveNextRequest, onMovePrevRequest } = latest.current;
    const target = direction === 1 ? nextSrc : direction === -1 ? prevSrc : null;
    const element = track.current;
    const width = media.current?.clientWidth ?? 0;
    writeSwipe(element, target ? -direction * width : 0, true);
    if (!target) return;
    const from = latest.current.mainSrc;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      element?.removeEventListener("transitionend", onEnd);
      leaving.current = from;
      setSwipedTo(target);
      if (direction === 1) onMoveNextRequest();
      else onMovePrevRequest();
      setTimeout(() => {
        if (leaving.current !== from) return;
        leaving.current = null;
        writeSwipe(track.current, 0, true);
      }, SWIPE_SETTLE_SLACK_MS);
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.target === element) settle();
    };
    element?.addEventListener("transitionend", onEnd);
    setTimeout(settle, SWIPE_MS + SWIPE_SETTLE_SLACK_MS);
  };

  const onDrag = (drag: DragGesture) => {
    const { zoomable, nextSrc, prevSrc } = latest.current;
    if (drag.first) {
      if (zoomable && isMagnifiedView(live.current)) gesture.current = { kind: "pan", start: live.current };
      else if (drag.axis === "x") gesture.current = { kind: "swipe" };
      else gesture.current = null;
    }
    const current = gesture.current;
    if (current?.kind === "pan") show(panView(live.current, drag.delta, box(), content()));
    if (current?.kind === "swipe") {
      const blocked = drag.movement.x > 0 ? !prevSrc : !nextSrc;
      writeSwipe(track.current, drag.movement.x * (blocked ? EDGE_RESISTANCE : 1), false);
    }
  };

  const onDragEnd = (drag: DragGesture) => {
    const current = gesture.current;
    gesture.current = null;
    if (current?.kind === "pan") commit(live.current);
    if (current?.kind === "swipe") finishSwipe(swipeTarget(drag.movement.x, drag.velocity.x, box().width));
  };

  useViewerGestures(
    media,
    {
      onDrag,
      onDragEnd,
      onPinch: pinch => {
        if (!latest.current.zoomable) return;
        if (pinch.first || gesture.current?.kind !== "pinch") gesture.current = { kind: "pinch", start: live.current };
        const start = gesture.current.start;
        show(pinchView(start, pinch.scale, fromCenter(pinch.startOrigin), fromCenter(pinch.origin), box(), content()));
      },
      onPinchEnd: () => {
        if (gesture.current?.kind !== "pinch") return;
        gesture.current = null;
        commit(live.current.scale < MIN_KEPT_SCALE ? UNZOOMED : live.current);
      },
      onWheel: wheel => {
        if (!latest.current.zoomable) return false;
        const scale = wheelScale(live.current, wheel.deltaY, wheel.ctrlKey);
        show(zoomAround(live.current, scale, fromCenter(wheel.point), box(), content()));
        if (wheelTimer.current) clearTimeout(wheelTimer.current);
        wheelTimer.current = setTimeout(() => commit(live.current), WHEEL_COMMIT_MS);
        return true;
      },
      onDoubleTap: point => {
        if (!latest.current.zoomable) return;
        commit(toggledView(live.current, fromCenter(point), box(), content()));
      },
    },
    enabled
  );

  return { swipedTo };
}
