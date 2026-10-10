import React from "react";
import classes from "./WorkerProgressRing.module.css";

type Props = Readonly<{
  // 0-100, or null when the job reports no measurable progress.
  percent: number | null;
}>;

// Drawn around the 30px avatar tile, 3px outside it on each side, so showing or
// hiding it never shifts the header layout.
export function WorkerProgressRing({ percent }: Props) {
  const indeterminate = percent === null;
  return (
    <svg
      className={indeterminate ? `${classes.ring} ${classes.indeterminate}` : classes.ring}
      viewBox="0 0 36 36"
      aria-hidden="true"
      data-testid="worker-progress-ring"
    >
      <circle className={classes.track} cx="18" cy="18" r="16.5" fill="none" strokeWidth="2" />
      <circle
        className={classes.arc}
        cx="18"
        cy="18"
        r="16.5"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={100}
        strokeDashoffset={indeterminate ? 75 : 100 - percent}
      />
    </svg>
  );
}
