import { Badge } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import classes from "./SplitDivider.module.css";

type Props = Readonly<{
  /** Where the divider is, as a fraction of the stage's width. */
  split: number;
  onChange: (split: number) => void;
  /** The stage's size in CSS pixels. */
  width: number;
  height: number;
}>;

const MIN = 0.02;
const clamp = (value: number) => Math.min(1 - MIN, Math.max(MIN, value));

/**
 * The split view's divider over the canvas: the picture before its edits left of it, after right,
 * labelled so. Dragged with the mouse, a pen or a finger; the arrow keys move it (Shift: further).
 */
export function SplitDivider({ split, onChange, width, height }: Props) {
  const { t } = useTranslation();
  const x = split * width;

  const follow = (event: React.PointerEvent<SVGGElement>) => {
    const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (box && box.width > 0) onChange(clamp((event.clientX - box.left) / box.width));
  };

  return (
    <div className={classes.root}>
      <Badge className={classes.before} variant="filled" color="dark" size="sm">
        {t("editor.split.before")}
      </Badge>
      <Badge className={classes.after} variant="filled" color="dark" size="sm">
        {t("editor.split.after")}
      </Badge>
      <svg className={classes.svg} viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height)}`}>
        <g
          className={classes.handle}
          // The stage pans a zoomed picture on a drag: one on the divider is the divider's.
          data-own-drag
          role="slider"
          tabIndex={0}
          aria-label={t("editor.split.divider")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(split * 100)}
          onPointerDown={event => {
            event.currentTarget.setPointerCapture(event.pointerId);
            follow(event);
          }}
          onPointerMove={event => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) follow(event);
          }}
          onDoubleClick={event => event.stopPropagation()}
          onKeyDown={event => {
            const step = event.shiftKey ? 0.1 : 0.02;
            if (event.key === "ArrowLeft") onChange(clamp(split - step));
            else if (event.key === "ArrowRight") onChange(clamp(split + step));
            else return;
            event.preventDefault();
          }}
        >
          <rect x={x - 16} y={0} width={32} height={height} className={classes.hit} />
          <line x1={x} y1={0} x2={x} y2={height} className={classes.line} />
          <circle cx={x} cy={height / 2} r={14} className={classes.knob} />
          <path
            d={`M${x - 4} ${height / 2 - 5} l-5 5 l5 5 M${x + 4} ${height / 2 - 5} l5 5 l-5 5`}
            className={classes.arrows}
          />
        </g>
      </svg>
    </div>
  );
}
