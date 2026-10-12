import classes from "./ScrollScrubber.module.css";

/**
 * The class of the element a ScrollScrubber scrolls (one of its children): it hides that element's
 * scrollbar, and the scrubber finds the element by it.
 */
export const SCROLL_SCRUBBER_TARGET = classes.target;

/** The first element on the page that carries SCROLL_SCRUBBER_TARGET. */
export function findScrollScrubberTarget(): Element | null {
  return SCROLL_SCRUBBER_TARGET ? document.getElementsByClassName(SCROLL_SCRUBBER_TARGET).item(0) : null;
}
