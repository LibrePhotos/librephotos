import { useElementSize, useMergedRef } from "@mantine/hooks";
import React, { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { PointerEvent, ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useIsDesktopLayout } from "../../hooks/useIsDesktopLayout";
import { DensityTrack } from "./DensityTrack";
import classes from "./ScrollScrubber.module.css";
import { findScrollScrubberTarget } from "./scrollScrubberTarget";
import type { ScrollerData, ScrollerPosition, ScrollerType, ScrubberStyle } from "./scrollScrubberTypes";
import { bucketAt, densityBuckets } from "./scrubberDensity";
import { ScrubberLabels } from "./ScrubberLabels";
import {
  atY,
  labelAt,
  layoutPositions,
  markersFor,
  scrollerYToScroll,
  scrollToScrollerY,
  scrubberStyle,
  THUMB_HEIGHT,
  thumbTop,
  viewportBracket,
} from "./scrubberLayout";
import { ThumbTrack } from "./ThumbTrack";
import { useScrubberGeometry } from "./useScrubberGeometry";
import { useScrubberVisibility } from "./useScrubberVisibility";

type Props = Readonly<{
  type: ScrollerType; // Type of scroller marks to display
  scrollPositions: ScrollerData[]; // Array of positions to show on the scroller (label and Y position on target scrollable area)
  targetHeight: number; // Height of the target scrollable area
  scrollToY: (y: number) => void; // Callback function that scrolls to a given Y position on target element
  children: ReactNode | null; // Target element must be one of the children nodes
  /** How the scrubber looks (the user's choice in a photo list's display menu); the thumb by default. */
  variant?: ScrubberStyle;
  /**
   * For a target the window scrolls: the sticky bar it scrolls under. The scrubber then runs from
   * that bar to the bottom of the window, however far the page has scrolled, and its scale takes in
   * whatever sits above the target (the timeline's memories).
   */
  stickyHeader?: RefObject<HTMLElement | null>;
}>;

/** The pointer's height on the scrubber, kept inside it. */
function pointerY(event: PointerEvent<HTMLDivElement>): number {
  const rect = event.currentTarget.getBoundingClientRect();
  return Math.max(Math.min(event.clientY - rect.top, rect.height), 0);
}

export function ScrollScrubber({
  type,
  scrollPositions,
  targetHeight,
  scrollToY,
  children,
  variant = "thumb",
  stickyHeader,
}: Props) {
  const { t } = useTranslation();
  // Mantine 9's useElementSize hands back a ref callback rather than a ref object.
  const { ref: sizeRef, width, height } = useElementSize<HTMLDivElement>();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);
  const mergedRef = useMergedRef(sizeRef, scrubberRef);
  const isDesktop = useIsDesktopLayout();
  const targetRef = useRef<Element | null>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [hoverY, setHoverY] = useState<number | null>(null);
  const [currentY, setCurrentY] = useState(0);
  const { visible, show, keepShowing, noteScroll } = useScrubberVisibility(draggingRef);
  const { offsetTop, viewportHeight, scrollOffset, scrollRange } = useScrubberGeometry({
    rootRef,
    stickyHeader,
    width,
    height,
    targetHeight,
  });
  const scale = useMemo(() => ({ height, scrollOffset, scrollRange }), [height, scrollOffset, scrollRange]);

  const positions = useMemo(() => layoutPositions(scrollPositions, type, scale), [scrollPositions, type, scale]);
  const markers = useMemo(() => markersFor(positions, type), [positions, type]);
  const buckets = useMemo(
    () => (variant === "density" ? densityBuckets(positions, type, height) : []),
    [variant, positions, type, height]
  );

  // Where the page is, on the scrubber. Not while the thumb is held: the pointer says where it is,
  // and a page that cannot scroll quite as far as asked would pull the thumb back.
  const syncCurrentPosition = useEffectEvent(() => {
    if (draggingRef.current) return;
    if (window.scrollY > 0) {
      setCurrentY(scrollToScrollerY(window.scrollY, scale));
      noteScroll(window.scrollY);
    } else if (targetRef.current) {
      setCurrentY(scrollToScrollerY(targetRef.current.scrollTop, scale));
      noteScroll(targetRef.current.scrollTop);
    } else {
      setCurrentY(0);
    }
  });

  useEffect(() => {
    targetRef.current = findScrollScrubberTarget();
    let frame = 0;
    const onScroll = () => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        syncCurrentPosition();
      });
    };
    const target = targetRef.current;
    window.addEventListener("scroll", onScroll, { passive: true });
    target?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      target?.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Also on any render after a scroll, and when the scale changes.
  const renderScrollY = window.scrollY;
  const renderTargetScrollTop = targetRef.current?.scrollTop;
  useEffect(() => {
    syncCurrentPosition();
  }, [renderScrollY, renderTargetScrollTop, scale]);

  // Scrolls to a point on the scrubber, at most once a frame while the thumb is dragged.
  const pendingScroll = useRef<number | null>(null);
  const jumpTo = (y: number) => {
    setCurrentY(y);
    const schedule = pendingScroll.current === null;
    pendingScroll.current = scrollerYToScroll(y, scale);
    if (!schedule) return;
    requestAnimationFrame(() => {
      if (pendingScroll.current !== null) scrollToY(pendingScroll.current);
      pendingScroll.current = null;
    });
  };

  const pickMarker = useCallback(
    (marker: ScrollerPosition) => {
      setCurrentY(marker.scrollerY);
      scrollToY(scrollOffset + marker.targetY);
    },
    [scrollOffset, scrollToY]
  );

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // A press on the hidden scrubber shows it; it does not jump the page.
    if (!visible) {
      show();
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    setDragging(true);
    jumpTo(pointerY(event));
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    keepShowing();
    const y = pointerY(event);
    setHoverY(y);
    if (draggingRef.current) jumpTo(y);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) {
      draggingRef.current = false;
      setDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
    // A touch has no hover; a mouse let go outside the scrubber no longer points at it.
    const rect = event.currentTarget.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right;
    if (event.pointerType !== "mouse" || !inside) setHoverY(null);
  };

  // do not display Scrollscubber if there is less than 2 positions, or nothing to scroll (this is useless in these cases)
  if (viewportHeight === 0 || scrollPositions.length < 2 || scrollRange === 0) {
    return <div ref={rootRef}>{children}</div>;
  }

  // The bubble: at the pointer while pointing, else beside the thumb or the bracket.
  const pointing = hoverY !== null;
  const bubbleY = hoverY ?? currentY;
  let bubble: { y: number; label: string } | null = null;
  if (variant === "density") {
    const bucket = bucketAt(buckets, bubbleY);
    const bracket = viewportBracket(currentY, { height, scrollRange, viewportHeight });
    if (bucket) {
      bubble = pointing
        ? { y: bubbleY, label: t("scrollscrubber.bucket", { label: bucket.label, count: bucket.count }) }
        : { y: bracket.top + bracket.height / 2, label: bucket.label };
    }
  } else {
    const label = labelAt(positions, bubbleY);
    if (label) bubble = { y: pointing ? bubbleY : thumbTop(currentY, height) + THUMB_HEIGHT / 2, label };
  }

  return (
    <div ref={rootRef}>
      {children}
      {/* Mouse and touch only: keyboard and screen reader users scroll the page itself */}
      <div
        ref={mergedRef}
        aria-hidden
        className={classes.scrubber}
        data-variant={variant}
        data-visible={visible || undefined}
        data-active={pointing || dragging || undefined}
        style={scrubberStyle(offsetTop, isDesktop)}
        onMouseEnter={show}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => {
          if (!draggingRef.current) setHoverY(null);
        }}
      >
        {variant === "density" ? (
          <DensityTrack
            buckets={buckets}
            currentY={currentY}
            hoverY={hoverY}
            height={height}
            scrollRange={scrollRange}
            viewportHeight={viewportHeight}
          />
        ) : (
          <ThumbTrack currentY={currentY} hoverY={hoverY} height={height} />
        )}
        {(pointing || dragging) && <ScrubberLabels markers={markers} onPick={pickMarker} />}
        {visible && bubble && (
          <div className={classes.bubble} style={atY(bubble.y)}>
            {bubble.label}
          </div>
        )}
      </div>
    </div>
  );
}
