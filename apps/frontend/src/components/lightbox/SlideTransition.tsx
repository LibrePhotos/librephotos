import React, { memo, useEffect, useState } from "react";
import classes from "./SlideTransition.module.css";

/** How long a slide's fade runs (SlideTransition.module.css); a leaving slide goes after this at most. */
const FADE_MS = 150;
/** Slack for a busy main thread before a leaving slide whose animationend never came is dropped. */
const FADE_SLACK_MS = 100;

/**
 * A slide's content as it was rendered. While the slide leaves, `frozen` keeps the last photo's
 * element (with the props it had) instead of the next photo's, without remounting it.
 */
const SlideContent = memo(
  function SlideContent({ children }: Readonly<{ frozen: boolean; children: React.ReactNode }>) {
    return children;
  },
  (_previous, next) => next.frozen
);

/**
 * The lightbox's main photo, changing with `slideKey`: the next photo fades in over the last one
 * while that one fades out, both at once. With AnimatePresence's "wait" mode the next photo was not even
 * mounted until the last one's 0.4 s exit had run, so every step took about a second however fast
 * it loaded; this keeps the crossfade (0.15 s) that replaced it.
 *
 * At most one photo leaves: stepping again before it has gone drops it at once, so holding an
 * arrow key never piles up photos. It goes on its animationend, or after the fade's length if that
 * event never comes (a hidden tab, `animation: none`). The first photo shows without a fade.
 *
 * Under `prefers-reduced-motion` only the fade runs, without the zoom: a slideshow (#1457) would
 * zoom every few seconds.
 */
export function SlideTransition({ slideKey, children }: Readonly<{ slideKey: string; children: React.ReactNode }>) {
  const [shownKey, setShownKey] = useState(slideKey);
  const [leavingKey, setLeavingKey] = useState<string | null>(null);
  // State adjusted while rendering, as React documents it for a value derived from a prop: the
  // photo that was shown starts to leave in the same render the next one appears in.
  if (slideKey !== shownKey) {
    setShownKey(slideKey);
    setLeavingKey(shownKey);
  }

  useEffect(() => {
    if (leavingKey === null) return undefined;
    const timer = setTimeout(() => setLeavingKey(null), FADE_MS + FADE_SLACK_MS);
    return () => clearTimeout(timer);
  }, [leavingKey]);

  return (
    <div className={classes.stage}>
      {leavingKey !== null && leavingKey !== slideKey && (
        <div
          key={leavingKey}
          className={`${classes.slide} ${classes.leaving}`}
          aria-hidden
          inert
          onAnimationEnd={event => {
            if (event.target === event.currentTarget) setLeavingKey(null);
          }}
        >
          <SlideContent frozen>{children}</SlideContent>
        </div>
      )}
      <div key={slideKey} className={leavingKey === null ? classes.slide : `${classes.slide} ${classes.entering}`}>
        <SlideContent frozen={false}>{children}</SlideContent>
      </div>
    </div>
  );
}
