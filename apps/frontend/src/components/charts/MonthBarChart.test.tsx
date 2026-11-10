/**
 * The Timeline chart without a chart library: every bar named for assistive tech, one tab stop with
 * the arrow keys between bars, and the tooltip on pointer, touch and keyboard focus.
 */
import React, { act } from "react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { MonthBarChart, plotLeft } from "./MonthBarChart";
import type { MonthBar } from "./photoMonthChart";

const bars: MonthBar[] = [
  { key: "2009-5", month: "May 2009", year: 2009, Photos: 3 },
  { key: "2009-6", month: "Jun 2009", year: 2009, Photos: 0 },
  { key: "2010-1", month: "Jan 2010", year: 2010, Photos: 12 },
];
const yearOf = new Map([
  ["2009-5", "2009"],
  ["2009-6", "2009"],
  ["2010-1", "2010"],
]);

async function render() {
  await renderInMantine(
    <MonthBarChart bars={bars} ticks={["2009-5", "2010-1"]} yearOf={yearOf} width={600} height={280} />
  );
  return defined(document.body.querySelector<SVGSVGElement>("svg[role='group']"));
}

const barElements = () => [...document.body.querySelectorAll<SVGGElement>("g[role='img']")];
// React builds pointerleave from pointerout: an out to an element outside the surface.

/** The tooltip's text, wherever the popover portalled it; null while it is closed. */
const tooltip = () => document.body.querySelector("[class*='tooltipDropdown']")?.textContent ?? null;

async function key(element: Element, name: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  });
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("MonthBarChart", () => {
  it("says what the chart spans and names every bar", async () => {
    const svg = await render();

    expect(svg.getAttribute("aria-label")).toBe(
      "Photos per month from May 2009 to Jan 2010, the most in Jan 2010 (12 photos). Use the arrow keys to read each bar."
    );
    expect(barElements().map(bar => bar.getAttribute("aria-label"))).toEqual([
      "May 2009: 3 photos",
      "Jun 2009: 0 photos",
      "Jan 2010: 12 photos",
    ]);
  });

  it("draws the bars to scale, a month of nothing as no bar, and the years under the axis", async () => {
    const svg = await render();
    const heights = barElements().map(bar => bar.querySelector("path")?.getAttribute("d") ?? "");

    expect(heights[1]).toBe("");
    // Up to a top of 12 (steps of 3): 12 photos stand four times as tall as 3
    expect([...svg.querySelectorAll("text")].map(text => text.textContent)).toEqual(
      expect.arrayContaining(["0", "3", "6", "9", "12"])
    );
    // The first V is the top plus the 2px rounding
    const top = (d: string) => Number(/V([\d.]+)/.exec(d)?.[1]) - 2;
    const axis = 280 - 24;
    expect((axis - top(defined(heights[2]))) / (axis - top(defined(heights[0])))).toBeCloseTo(4, 1);
    expect([...svg.querySelectorAll("text")].map(text => text.textContent)).toEqual(
      expect.arrayContaining(["2009", "2010"])
    );
  });

  it("is one tab stop; the arrow keys, Home and End step through the bars and show each", async () => {
    await render();
    const [first, second, third] = barElements();
    expect(barElements().map(bar => bar.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);

    await act(async () => defined(first).focus());
    expect(tooltip()).toBe("May 20093 photos");

    await key(defined(first), "ArrowRight");
    expect(document.activeElement).toBe(second);
    expect(tooltip()).toBe("Jun 20090 photos");

    await key(defined(second), "End");
    expect(document.activeElement).toBe(third);
    await key(defined(third), "ArrowRight");
    expect(document.activeElement).toBe(third);
    await key(defined(third), "Home");
    expect(document.activeElement).toBe(first);

    // Tab comes back to the bar last shown
    await key(defined(first), "ArrowRight");
    expect(barElements().map(bar => bar.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);

    await key(defined(second), "Escape");
    expect(tooltip()).toBeNull();
  });

  it("shows the bar under the pointer, anywhere in its column, and hides it when the mouse leaves", async () => {
    const svg = await render();
    svg.getBoundingClientRect = () => new DOMRect(0, 0, 600, 280);
    const surface = defined(svg.querySelector("rect[class*='pointerSurface']"));

    // The plot runs from 23 (right of the two-digit labels) to 600: three slots of 192.33px
    await act(async () => {
      surface.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 48 + 181.33 * 2 + 10, clientY: 20, bubbles: true })
      );
    });
    expect(tooltip()).toBe("Jan 201012 photos");

    await act(async () => {
      surface.dispatchEvent(
        new PointerEvent("pointerout", { pointerType: "mouse", bubbles: true, relatedTarget: document.body })
      );
    });
    expect(tooltip()).toBeNull();
  });

  it("keeps a tapped bar shown when the finger lifts", async () => {
    const svg = await render();
    svg.getBoundingClientRect = () => new DOMRect(0, 0, 600, 280);
    const surface = defined(svg.querySelector("rect[class*='pointerSurface']"));

    await act(async () => {
      surface.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 60, clientY: 200, pointerType: "touch", bubbles: true })
      );
      surface.dispatchEvent(
        new PointerEvent("pointerout", { pointerType: "touch", bubbles: true, relatedTarget: document.body })
      );
    });
    expect(tooltip()).toBe("May 20093 photos");
  });

  it("starts the plot right of its widest count label, which starts at the left edge", () => {
    expect(plotLeft([0, 3, 6, 9, 12])).toBe(23);
    expect(plotLeft([0, 300, 600])).toBe(31);
    expect(plotLeft([0, 2000, 4000, 6000])).toBe(38);
    // Never past what photoMonthChart kept free when it chose the bars
    expect(plotLeft([0, 50000, 100000])).toBe(48);
  });
});
