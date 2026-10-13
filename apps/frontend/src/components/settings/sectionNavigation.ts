import { createContext } from "react";
import classes from "./SectionNav.module.css";

/** Marks the element of a section that the navigation can jump to (set by SettingsSection). */
const SECTION_ATTRIBUTE = "data-settings-section";

/** One entry of a page's section navigation: the anchor id and the card title it shows. */
export type NavSection = { id: string; label: string };

/** What a section's "#" link can do on a page with SectionNav (which provides it). */
export type SectionNavActions = {
  /** Scrolls to the section and puts its id in the URL. */
  goTo: (id: string) => void;
  /** Copies a link to the section, then goes to it. */
  copyLink: (id: string) => void;
};

export const SectionNavContext = createContext<SectionNavActions | undefined>(undefined);

/** The id of the section an element is in. Provided by SettingsSection. */
export const SectionIdContext = createContext<string | undefined>(undefined);

/** The section element with this id, or undefined when the page has none (a stale or mistyped hash). */
export function sectionElement(id: string): HTMLElement | undefined {
  const element = document.getElementById(id);
  return element?.hasAttribute(SECTION_ATTRIBUTE) ? element : undefined;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Scrolls a section to the top, moves the focus into it (so Tab continues inside the card) and
 * outlines it briefly. Without motion, it only jumps.
 */
export function revealSection(element: HTMLElement): void {
  const reducedMotion = prefersReducedMotion();
  element.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  element.focus({ preventScroll: true });
  const flash = classes.flash;
  if (reducedMotion || !flash) {
    return;
  }
  // Restart the outline when the same card is picked twice.
  element.classList.remove(flash);
  void element.offsetWidth;
  element.classList.add(flash);
  element.addEventListener("animationend", () => element.classList.remove(flash), { once: true });
}

/**
 * The section being read: the last one whose top has scrolled past `offset` (the first one before
 * that), and the last one once the page is scrolled to the bottom, where it may never reach the top.
 */
export function pickActiveSection(
  tops: readonly { id: string; top: number }[],
  offset: number,
  atBottom: boolean
): string | undefined {
  if (atBottom) {
    return tops.at(-1)?.id;
  }
  let active = tops[0]?.id;
  for (const { id, top } of tops) {
    if (top <= offset) {
      active = id;
    }
  }
  return active;
}
