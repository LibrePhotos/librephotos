import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import classes from "./MapResizeHandle.module.css";

type Props = Readonly<{
  height: number;
  min: number;
  max: number;
  onChange: (height: number) => void;
}>;

// One arrow key press, in pixels; Page Up and Page Down move five steps.
const STEP = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The height an arrow, page or Home/End key asks for, or null for any other key. */
export function heightForKey(key: string, height: number, min: number, max: number): number | null {
  switch (key) {
    case "ArrowUp":
      return clamp(height - STEP, min, max);
    case "ArrowDown":
      return clamp(height + STEP, min, max);
    case "PageUp":
      return clamp(height - STEP * 5, min, max);
    case "PageDown":
      return clamp(height + STEP * 5, min, max);
    case "Home":
      return min;
    case "End":
      return max;
    default:
      return null;
  }
}

/**
 * The grip under the Places map that makes it taller or shorter (#343): drag it, or focus it and
 * use the arrow keys. A separator with its value, so a screen reader says how tall the map is.
 */
export function MapResizeHandle({ height, min, max, onChange }: Props) {
  const { t } = useTranslation();
  // Where the drag started: the pointer's y and the map's height then.
  const drag = useRef<{ y: number; height: number } | null>(null);

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={t("placealbum.mapHeight")}
      aria-valuenow={height}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={classes.handle}
      onPointerDown={event => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { y: event.clientY, height };
      }}
      onPointerMove={event => {
        if (drag.current) onChange(clamp(drag.current.height + event.clientY - drag.current.y, min, max));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onKeyDown={event => {
        const next = heightForKey(event.key, height, min, max);
        if (next === null) return;
        event.preventDefault();
        onChange(next);
      }}
    >
      <div className={classes.grip} />
    </div>
  );
}
