/** The Location timeline bar: a named, focusable segment per stay, and its tooltip. */
import { Settings } from "luxon";
import React, { act } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { StayBarChart } from "./StayBarChart";

const day = 86400;
const may2020 = Date.UTC(2020, 4, 15) / 1000;
const stays = [
  { loc: "Lisbon", data: [30 * day], color: "#0", start: may2020, end: may2020 + 30 * day },
  { loc: "Berlin", data: [90 * day], color: "#0", start: may2020 + 31 * day, end: may2020 + 121 * day },
  { loc: "Lisbon", data: [10 * day], color: "#0", start: may2020 + 122 * day, end: may2020 + 132 * day },
];
const colors = ["red", "blue", "red"];

let locale: string;
beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
  locale = Settings.defaultLocale;
  Settings.defaultLocale = "en-US";
});
afterAll(() => {
  Settings.defaultLocale = locale;
});
beforeEach(() => {
  document.body.innerHTML = "";
});

const segments = () => [...document.body.querySelectorAll<SVGGElement>("g[role='img']")];
const tooltip = () => document.body.querySelector("[class*='tooltipDropdown']")?.textContent ?? null;

describe("StayBarChart", () => {
  it("names the chart and every stay, a place visited twice twice", async () => {
    await renderInMantine(<StayBarChart stays={stays} colors={colors} width={420} height={56} />);

    expect(document.body.querySelector("svg[role='group']")?.getAttribute("aria-label")).toBe(
      "Where your photos were taken from May 2020 to Sep 2020, place by place. Use the arrow keys to read each stay."
    );
    expect(segments().map(segment => segment.getAttribute("aria-label"))).toEqual([
      "Lisbon, May 2020 – Jun 2020",
      "Berlin, Jun 2020 – Sep 2020",
      "Lisbon, Sep 2020 – Sep 2020",
    ]);
  });

  it("draws each stay as long as its share of the time, edge to edge, in its place's colour", async () => {
    await renderInMantine(<StayBarChart stays={stays} colors={colors} width={420} height={56} />);

    const rects = segments().map(segment => defined(segment.querySelector("rect")));
    expect(rects.map(rect => Number(rect.getAttribute("width")))).toEqual([
      (30 / 130) * 420,
      (90 / 130) * 420,
      (10 / 130) * 420,
    ]);
    expect(rects.map(rect => rect.getAttribute("fill"))).toEqual(colors);
  });

  it("shows a stay on keyboard focus and steps with the arrow keys", async () => {
    await renderInMantine(<StayBarChart stays={stays} colors={colors} width={420} height={56} />);
    const [first, second] = segments();

    await act(async () => defined(first).focus());
    expect(tooltip()).toBe("LisbonMay 2020 – Jun 2020");
    await act(async () => {
      defined(first).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(document.activeElement).toBe(second);
    expect(tooltip()).toBe("BerlinJun 2020 – Sep 2020");
    // The shown stay is marked (outlined, the others faded by the stylesheet)
    expect(segments().map(segment => segment.hasAttribute("data-active"))).toEqual([false, true, false]);
    expect(document.body.querySelector("svg[role='group']")?.hasAttribute("data-active")).toBe(true);
  });
});
