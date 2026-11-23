import React, { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { DistributionBarChart, thinAxisLabels, type DistributionBar } from "./DistributionBarChart";

const bars: DistributionBar[] = [
  { key: "100", axis: "100", name: "ISO 100", count: 3, search: { iso_min: 100, iso_max: 103 } },
  { key: "400", axis: "400", name: "ISO 400", count: 12, search: { iso_min: 400, iso_max: 400 } },
  { key: "1600", axis: "1600", name: "ISO 1600", count: 6, search: { iso_min: 1600, iso_max: 1600 } },
];

const onSelect = vi.fn<(bar: DistributionBar) => void>();

async function render() {
  await renderInMantine(
    <DistributionBarChart bars={bars} summary="ISO of your photos" onSelect={onSelect} width={600} height={220} />
  );
  const svg = defined(document.body.querySelector<SVGSVGElement>("svg[role='group']"));
  svg.getBoundingClientRect = () => new DOMRect(0, 0, 600, 220);
  return svg;
}

const barLinks = () => [...document.body.querySelectorAll<SVGGElement>("g[role='link']")];
const tooltip = () => document.body.querySelector("[class*='tooltipDropdown']")?.textContent ?? null;
const surface = () => defined(document.body.querySelector("rect[class*='linkSurface']"));

const LEFT = 23;
const SLOT = (600 - LEFT) / 3;
const xOf = (index: number) => LEFT + SLOT * index + SLOT / 2;

async function tap(index: number, pointerType: string) {
  await act(async () => {
    surface().dispatchEvent(
      new PointerEvent("pointerdown", { clientX: xOf(index), clientY: 100, pointerType, bubbles: true })
    );
    surface().dispatchEvent(new MouseEvent("click", { clientX: xOf(index), clientY: 100, bubbles: true }));
  });
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  onSelect.mockReset();
});

describe("DistributionBarChart", () => {
  it("names every bar as a link to its photos, with the value labels under the axis", async () => {
    const svg = await render();
    expect(svg.getAttribute("aria-label")).toBe("ISO of your photos");
    expect(barLinks().map(bar => bar.getAttribute("aria-label"))).toEqual([
      "ISO 100: 3 photos",
      "ISO 400: 12 photos",
      "ISO 1600: 6 photos",
    ]);
    expect([...svg.querySelectorAll("text[class*='axisLabel']")].map(text => text.textContent)).toEqual([
      "100",
      "400",
      "1600",
    ]);
  });

  it("opens a bar's search on a mouse click", async () => {
    await render();
    await tap(1, "mouse");
    expect(onSelect).toHaveBeenCalledWith(bars[1]);
  });

  it("shows a bar on the first tap and opens its search on a second tap of the same bar", async () => {
    await render();
    await tap(0, "touch");
    expect(onSelect).not.toHaveBeenCalled();
    expect(tooltip()).toBe("ISO 1003 photos");

    await tap(2, "touch");
    expect(onSelect).not.toHaveBeenCalled();
    expect(tooltip()).toBe("ISO 16006 photos");

    await tap(2, "touch");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(bars[2]);
  });

  it("opens the focused bar's search with Enter or Space", async () => {
    await render();
    const [first, second] = barLinks();
    await act(async () => defined(first).focus());
    expect(tooltip()).toBe("ISO 1003 photos");
    await act(async () => {
      defined(first).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(document.activeElement).toBe(second);
    await act(async () => {
      defined(second).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith(bars[1]);
    await act(async () => {
      defined(second).dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });
});

describe("thinAxisLabels", () => {
  it("labels every bar while they fit", () => {
    expect(thinAxisLabels(["100", "200", "400"], 600).map(label => label.index)).toEqual([0, 1, 2]);
  });

  it("labels every few bars when the longest label would collide", () => {
    const texts = Array.from({ length: 30 }, (_unused, index) => `${index * 100} mm`);
    expect(thinAxisLabels(texts, 300).map(label => label.index)).toEqual([0, 6, 12, 18, 24]);
  });
});
