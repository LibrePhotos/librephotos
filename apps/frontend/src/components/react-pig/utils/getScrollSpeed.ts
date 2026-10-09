import type { ScrollSpeed } from "../types";

// https://stackoverflow.com/a/22599173/2255980
let lastPos = 0;
let newPos = 0;
let delta = 0;
let timeout: ReturnType<typeof setTimeout> | undefined;

export default function getScrollSpeed(
  latestYOffset: number,
  scrollThrottleMs: number,
  idleCallback: (speed: ScrollSpeed) => void
): ScrollSpeed {
  newPos = latestYOffset;

  if (lastPos !== 0) delta = Math.abs(newPos - lastPos);

  lastPos = newPos;

  let scrollSpeed: ScrollSpeed;
  if (delta < 1000) {
    scrollSpeed = "slow";
  } else if (delta < 3000) {
    scrollSpeed = "medium";
  } else {
    scrollSpeed = "fast"; // only really happens when user grabs the scrollbar
  }

  // kind of like a reversed debounce,
  // if this function hasn't been called in a little while, fire the idleCallback function
  clearTimeout(timeout);
  timeout = setTimeout(() => {
    timeout = undefined;
    idleCallback("slow");
  }, scrollThrottleMs * 2);

  return scrollSpeed;
}
