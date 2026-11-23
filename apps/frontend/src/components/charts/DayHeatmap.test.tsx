import { DateTime, Settings } from "luxon";
import React, { act } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { formatCalendarDay } from "../../util/dateUtils";
import { defined } from "../../util/defined.test-utils";
import { renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { DayHeatmap } from "./DayHeatmap";
import { dayHeatmap } from "./dayHeatmapGrid";

const stubs = vi.hoisted(() => ({
  navigate: vi.fn<(options: { to: string; search: Record<string, string> }) => Promise<void>>(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => stubs.navigate }));

const grid = dayHeatmap(
  [
    { day: "2023-01-02", count: 1 },
    { day: "2023-01-09", count: 6 },
  ],
  2023,
  1,
  DateTime.local(2026, 11, 23)
);

const cellFor = (day: string) =>
  defined(
    [...document.body.querySelectorAll<SVGGElement>("g[role='link']")].find(cell =>
      cell.getAttribute("aria-label")?.startsWith(`${formatCalendarDay(day)}:`)
    )
  );

async function key(element: Element, name: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  });
}

let locale: string;
beforeAll(async () => {
  setUpMantineDom();
  locale = Settings.defaultLocale;
  Settings.defaultLocale = "en-US";
  await i18n.changeLanguage("en");
});

afterAll(() => {
  Settings.defaultLocale = locale;
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.navigate.mockReset();
});

describe("DayHeatmap", () => {
  it("moves a week with the left and right arrows and a day with up and down", async () => {
    await renderInMantine(<DayHeatmap grid={grid} width={1200} />);
    const monday = cellFor("2023-01-02");

    await act(async () => monday.focus());
    await key(monday, "ArrowRight");
    expect(document.activeElement).toBe(cellFor("2023-01-09"));

    await key(cellFor("2023-01-09"), "ArrowDown");
    expect(document.activeElement).toBe(cellFor("2023-01-10"));

    await key(cellFor("2023-01-10"), "ArrowUp");
    expect(document.activeElement).toBe(cellFor("2023-01-09"));

    await key(cellFor("2023-01-09"), "ArrowLeft");
    expect(document.activeElement).toBe(monday);

    await key(monday, "Enter");
    expect(stubs.navigate).toHaveBeenCalledWith({
      to: "/search",
      search: { taken_after: "2023-01-02", taken_before: "2023-01-02" },
    });
  });

  it("stays on the first and last day rather than wrapping", async () => {
    await renderInMantine(<DayHeatmap grid={grid} width={1200} />);
    const first = cellFor("2023-01-01");
    const last = cellFor("2023-12-31");

    await act(async () => first.focus());
    await key(first, "ArrowLeft");
    expect(document.activeElement).toBe(first);
    await key(first, "End");
    expect(document.activeElement).toBe(last);
    await key(last, "ArrowRight");
    expect(document.activeElement).toBe(last);
  });

  it("starts the tab stop on the latest day", async () => {
    await renderInMantine(<DayHeatmap grid={grid} width={1200} />);
    expect(cellFor("2023-12-31").getAttribute("tabindex")).toBe("0");
    expect(cellFor("2023-01-01").getAttribute("tabindex")).toBe("-1");
  });

  it("keeps cells tappable on a phone and scrolls instead of shrinking them", async () => {
    await renderInMantine(<DayHeatmap grid={grid} width={360} />);
    const rect = defined(cellFor("2023-06-01").querySelector("rect"));
    const svg = defined(document.body.querySelector("svg[role='group']"));

    expect(Number(rect.getAttribute("width"))).toBeGreaterThanOrEqual(12);
    expect(Number(svg.getAttribute("width"))).toBeGreaterThan(360);
  });

  it("paints the cells and the legend from the same level classes", async () => {
    await renderInMantine(<DayHeatmap grid={grid} width={1200} />);
    const busy = defined(cellFor("2023-01-09").querySelector("rect"));
    const swatches = [...document.body.querySelectorAll("[class*='daySwatch']")];

    expect(busy.getAttribute("data-level")).toBe("4");
    expect(swatches).toHaveLength(5);
    expect(defined(swatches[4]).className).toContain(busy.getAttribute("class") ?? "missing");
  });
});
