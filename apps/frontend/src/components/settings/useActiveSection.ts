import { useEffect, useState } from "react";
import { pickActiveSection, sectionElement } from "./sectionNavigation";

function measureActiveSection(ids: readonly string[], offset: number): string | undefined {
  const tops = ids.flatMap(id => {
    const element = sectionElement(id);
    return element ? [{ id, top: element.getBoundingClientRect().top }] : [];
  });
  // A page that does not scroll is at its bottom too; its first section is the one in view.
  const atBottom =
    window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
  return pickActiveSection(tops, offset, atBottom);
}

/**
 * The id of the section in view (scroll spy), measured again after each scroll or resize, at most
 * once per frame. `offset` is how far below the viewport top a section counts as reached.
 */
export function useActiveSection(ids: readonly string[], offset: number): string | undefined {
  const [active, setActive] = useState<string | undefined>(ids[0]);
  // The ids as one string, so a new array with the same ids does not restart the listeners.
  const idList = ids.join(" ");

  useEffect(() => {
    const sectionIds = idList.split(" ");
    let frame = 0;
    const measure = () => {
      frame = 0;
      setActive(measureActiveSection(sectionIds, offset));
    };
    const schedule = () => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(measure);
      }
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.cancelAnimationFrame(frame);
    };
  }, [idList, offset]);

  return active;
}
