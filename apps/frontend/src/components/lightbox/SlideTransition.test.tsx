/**
 * The lightbox's crossfade between photos, which motion's AnimatePresence ran before: the last photo
 * stays (the same element, with the props it had) while it fades out, at most one at a time, and
 * goes on its animationend or after the fade's length.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { SlideTransition } from "./SlideTransition";
import css from "./SlideTransition.module.css?raw";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.useRealTimers();
});

function Photo({ id }: Readonly<{ id: string }>) {
  return <img data-photo={id} alt="" />;
}

function show(id: string) {
  if (!container) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() =>
    defined(root).render(
      <SlideTransition slideKey={id}>
        <Photo id={id} />
      </SlideTransition>
    )
  );
}

// React listens for the event name the browser fires: jsdom has no AnimationEvent, so React falls
// back to the prefixed name there, where a browser fires "animationend".
const ANIMATION_END = "AnimationEvent" in window ? "animationend" : "webkitAnimationEnd";

const slides = () => [...defined(container).querySelectorAll<HTMLElement>("[class*=slide]")];
const leaving = () => slides().filter(slide => slide.className.includes("leaving"));
const shown = () => slides().filter(slide => !slide.className.includes("leaving"));
const photoIn = (slide: HTMLElement | undefined) => defined(slide).querySelector("img")?.dataset.photo;

describe("SlideTransition", () => {
  it("shows the first photo without a fade", () => {
    show("a");

    expect(slides()).toHaveLength(1);
    expect(photoIn(slides()[0])).toBe("a");
    expect(slides()[0]?.className).not.toMatch(/entering/);
  });

  it("fades the next photo in while the last one, unchanged, fades out", () => {
    show("a");
    const first = defined(container).querySelector("img");

    show("b");

    expect(slides()).toHaveLength(2);
    expect(photoIn(leaving()[0])).toBe("a");
    // The same element, not a remount: its picture does not load again.
    expect(leaving()[0]?.querySelector("img")).toBe(first);
    expect(photoIn(shown()[0])).toBe("b");
    expect(shown()[0]?.className).toMatch(/entering/);
  });

  it("keeps the leaving photo away from assistive tech, focus and the pointer", () => {
    show("a");
    show("b");

    const out = defined(leaving()[0]);
    expect(out.getAttribute("aria-hidden")).toBe("true");
    expect(out.hasAttribute("inert")).toBe(true);
  });

  it("drops the last photo when its fade ends, not when a child's does", () => {
    show("a");
    show("b");
    const out = defined(leaving()[0]);

    act(() => {
      out.querySelector("img")?.dispatchEvent(new Event(ANIMATION_END, { bubbles: true }));
    });
    expect(leaving()).toHaveLength(1);

    act(() => {
      out.dispatchEvent(new Event(ANIMATION_END, { bubbles: true }));
    });
    expect(leaving()).toHaveLength(0);
    expect(slides()).toHaveLength(1);
    expect(photoIn(slides()[0])).toBe("b");
  });

  it("drops the last photo after the fade's length when no animationend comes", () => {
    vi.useFakeTimers();
    show("a");
    show("b");

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(leaving()).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(leaving()).toHaveLength(0);
  });

  it("keeps at most one photo leaving however fast the photos change", () => {
    vi.useFakeTimers();
    show("p0");
    for (let step = 1; step <= 10; step += 1) {
      show(`p${step}`);
      act(() => {
        vi.advanceTimersByTime(30);
      });
      expect(slides()).toHaveLength(2);
      expect(photoIn(leaving()[0])).toBe(`p${step - 1}`);
      expect(photoIn(shown()[0])).toBe(`p${step}`);
    }

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(slides()).toHaveLength(1);
  });

  it("brings a leaving photo straight back when the viewer steps back to it", () => {
    show("a");
    show("b");
    show("a");

    expect(slides()).toHaveLength(2);
    expect(photoIn(leaving()[0])).toBe("b");
    expect(photoIn(shown()[0])).toBe("a");
  });
});

describe("SlideTransition timing (SlideTransition.module.css)", () => {
  /** The declarations of the first rule for `selector` in `block`. */
  const rule = (block: string, selector: string) => new RegExp(`\\${selector}\\s*{([^}]*)}`).exec(block)?.[1] ?? "";
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  const keyframes = (name: string) => new RegExp(`@keyframes ${name}\\s*{([\\s\\S]*?)}\\s*}`).exec(css)?.[1] ?? "";

  it("runs motion's 0.15 s ease, zooming from 98 % in and to 102 % out", () => {
    expect(rule(css, ".entering")).toContain("slideIn 150ms cubic-bezier(0.4, 0, 0.2, 1)");
    expect(rule(css, ".leaving")).toContain("slideOut 150ms cubic-bezier(0.4, 0, 0.2, 1) forwards");
    expect(keyframes("slideIn")).toMatch(/opacity: 0;\s*transform: scale\(0\.98\)/);
    expect(keyframes("slideOut")).toMatch(/opacity: 0;\s*transform: scale\(1\.02\)/);
  });

  // A slideshow (#1457) changes photo every few seconds: with reduced motion the zoom is left out
  // and only the crossfade stays.
  it("only crossfades under prefers-reduced-motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(rule(reduced, ".entering")).toContain("animation-name: fadeIn");
    expect(rule(reduced, ".leaving")).toContain("animation-name: fadeOut");
    expect(keyframes("fadeIn")).not.toContain("transform");
    expect(keyframes("fadeOut")).not.toContain("transform");
  });
});
