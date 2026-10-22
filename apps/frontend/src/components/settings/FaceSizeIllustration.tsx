import React from "react";
import classes from "./MinFaceSizeField.module.css";

/** The drawing is 600 by 400: its shorter side, which the minimum face size is a share of. */
const SHORTER_SIDE = 400;

type Person = Readonly<{ x: number; y: number; head: number }>;

/** Five people from close to far: their heads are 24 %, 11 %, 7 %, 3 % and 1.5 % of the height. */
const PEOPLE: readonly Person[] = [
  { x: 140, y: 200, head: 96 },
  { x: 300, y: 170, head: 44 },
  { x: 380, y: 190, head: 28 },
  { x: 520, y: 210, head: 12 },
  { x: 470, y: 215, head: 6 },
];

/** Whether a face of this height (in drawing units) is saved with `minFaceSize`. */
function isKept(head: number, minFaceSize: number): boolean {
  return head >= minFaceSize * SHORTER_SIDE;
}

type Props = Readonly<{
  /** The share of the shorter side under which a face is skipped; 0 keeps every face. */
  minFaceSize: number;
  label: string;
}>;

/**
 * A made-up photo with five faces of different sizes (#2749): the faces `minFaceSize` keeps have a
 * solid box, the skipped ones a dashed one, so "4 %" means something before a scan shows it.
 */
export function FaceSizeIllustration({ minFaceSize, label }: Props) {
  return (
    <svg className={classes.scene} viewBox="0 0 600 400" role="img" aria-label={label}>
      <rect className={classes.sky} width="600" height="240" />
      <rect className={classes.ground} y="240" width="600" height="160" />
      {PEOPLE.map(({ x, y, head }) => {
        const radius = head / 2;
        const kept = isKept(head, minFaceSize);
        return (
          <g key={`${x}-${y}`}>
            <rect
              className={classes.body}
              x={x - radius}
              y={y + radius}
              width={head}
              height={head * 1.7}
              rx={radius / 2}
            />
            <circle className={classes.head} cx={x} cy={y} r={radius} />
            <rect
              className={kept ? classes.kept : classes.skipped}
              data-kept={kept}
              x={x - radius - 2}
              y={y - radius - 2}
              width={head + 4}
              height={head + 4}
              rx={2}
            />
          </g>
        );
      })}
    </svg>
  );
}
