import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CurveChannel, CurvePoints } from "../engine/recipe";
import { histogramPath } from "../histogram/histogramModel";
import {
  addPoint,
  canRemove,
  curveSamples,
  dragPoint,
  hitsCurve,
  nearestPoint,
  nudgePoint,
  removePoint,
  type Point,
} from "./curveModel";
import classes from "./ToneCurveEditor.module.css";

/** The drawing's size in SVG units (the box is square and scales with the panel). */
const SIZE = 256;
/** How close, in CSS pixels, a press has to be to a point or the curve to take it. */
const HIT_PX = 12;
const STEP = 1 / 255;
const GRID = [0.25, 0.5, 0.75];

type Props = Readonly<{
  channel: CurveChannel;
  points: CurvePoints;
  /** The histogram of the channel the curve shapes, drawn behind it; null while there is none. */
  bins: Uint32Array | null;
  /** The curve's name, translated ("Red"): part of each point's accessible name. */
  channelName: string;
  /** The curve during a drag or a held arrow key. */
  onLive: (points: CurvePoints) => void;
  /** The drag or key press ended: one step. */
  onCommit: () => void;
  /** A change made at once (a point removed): one step. */
  onSet: (points: CurvePoints) => void;
}>;

type Drag = Readonly<{ start: CurvePoints; index: number; pointerId: number }>;

const toSvg = ([x, y]: readonly [number, number]) => ({ cx: x * SIZE, cy: (1 - y) * SIZE });
const level = (value: number) => Math.round(value * 255);

/**
 * The tone curve: a square with a light grid and the channel's histogram, the curve as the engine
 * interpolates it, and its points. Press the curve to add a point (up to 16) and drag it; drag a
 * point (its x stays between its neighbours); remove one with a double click, Delete, or by dragging
 * it out of the box. The arrow keys move the focused point (Shift: ten times as far).
 */
export function ToneCurveEditor({ channel, points, bins, channelName, onLive, onCommit, onSet }: Props) {
  const { t } = useTranslation();
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const curve = curveSamples(points)
    .map(({ x, y }, i) => `${i === 0 ? "M" : "L"}${(x * SIZE).toFixed(1)} ${((1 - y) * SIZE).toFixed(1)}`)
    .join(" ");

  /** The pointer in the unit square (y up), and the hit radius there. */
  const locate = (event: React.PointerEvent | React.MouseEvent): { p: Point; radius: number } | null => {
    const box = svg.current?.getBoundingClientRect();
    if (!box || box.width === 0) return null;
    const p = { x: (event.clientX - box.left) / box.width, y: 1 - (event.clientY - box.top) / box.height };
    return { p, radius: HIT_PX / box.width };
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const at = locate(event);
    if (!at || event.button !== 0) return;
    let index = nearestPoint(points, at.p, at.radius);
    let start = points;
    if (index === null && hitsCurve(points, at.p, at.radius)) {
      const added = addPoint(points, at.p.x);
      if (added) {
        ({ index, points: start } = added);
        onLive(start);
      }
    }
    if (index === null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { start, index, pointerId: event.pointerId };
    setSelected(index);
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const current = drag.current;
    const at = locate(event);
    if (!current || current.pointerId !== event.pointerId || !at) return;
    const { points: next, removed } = dragPoint(current.start, current.index, at.p);
    setSelected(removed ? null : current.index);
    onLive(next);
  };

  const finish = (event: React.PointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    onCommit();
  };

  const onDoubleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    const at = locate(event);
    const index = at ? nearestPoint(points, at.p, at.radius) : null;
    if (index === null || !canRemove(points, index)) return;
    setSelected(null);
    onSet(removePoint(points, index));
  };

  const onKeyDown = (index: number) => (event: React.KeyboardEvent<SVGCircleElement>) => {
    const step = event.shiftKey ? STEP * 10 : STEP;
    const moves: Partial<Record<string, [number, number]>> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      onLive(nudgePoint(points, index, move[0], move[1]));
    } else if ((event.key === "Delete" || event.key === "Backspace") && canRemove(points, index)) {
      event.preventDefault();
      setSelected(null);
      onSet(removePoint(points, index));
    }
  };
  const onKeyUp = (event: React.KeyboardEvent<SVGCircleElement>) => {
    if (event.key.startsWith("Arrow")) onCommit();
  };

  const focused = selected !== null ? points[selected] : undefined;
  return (
    <div className={classes.root} data-channel={channel}>
      <svg
        ref={svg}
        className={classes.box}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onDoubleClick={onDoubleClick}
        role="group"
        aria-label={t("editor.curve.box", { channel: channelName })}
      >
        {bins && <path d={histogramPath(bins, SIZE, SIZE)} className={classes.histogram} />}
        {GRID.map(at => (
          <g key={at} className={classes.grid}>
            <line x1={at * SIZE} y1={0} x2={at * SIZE} y2={SIZE} />
            <line x1={0} y1={at * SIZE} x2={SIZE} y2={at * SIZE} />
          </g>
        ))}
        <line x1={0} y1={SIZE} x2={SIZE} y2={0} className={classes.diagonal} />
        <path d={curve} className={classes.curve} />
        {points.map((point, index) => (
          <circle
            // eslint-disable-next-line react/no-array-index-key -- a point has no identity besides its place
            key={index}
            {...toSvg(point)}
            r={index === selected ? 6 : 5}
            className={classes.point}
            data-selected={index === selected || undefined}
            tabIndex={0}
            role="slider"
            aria-label={t("editor.curve.point", { index: index + 1, count: points.length, channel: channelName })}
            aria-valuemin={0}
            aria-valuemax={255}
            aria-valuenow={level(point[1])}
            aria-valuetext={t("editor.curve.pointValue", { input: level(point[0]), output: level(point[1]) })}
            onFocus={() => setSelected(index)}
            onKeyDown={onKeyDown(index)}
            onKeyUp={onKeyUp}
          />
        ))}
      </svg>
      <div className={classes.readout} aria-hidden>
        {focused
          ? t("editor.curve.pointValue", { input: level(focused[0]), output: level(focused[1]) })
          : t("editor.curve.hint")}
      </div>
    </div>
  );
}
