import { describe, expect, it } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { locationTimelineChart } from "./locationTimelineChart";

// The shape of the backend's location timeline test fixture: home, two trips
// that are each visited twice.
const timeline = [
  { loc: "Germany", data: [22208418], color: "#1", start: 0, end: 1 },
  { loc: "Canada", data: [9413609], color: "#2", start: 2, end: 3 },
  { loc: "France", data: [20648022], color: "#3", start: 4, end: 5 },
  { loc: "Canada", data: [6132785], color: "#4", start: 6, end: 7 },
  { loc: "France", data: [79828], color: "#5", start: 8, end: 9 },
];

describe("locationTimelineChart", () => {
  it("keeps every stay as its own segment, in order", () => {
    const { series } = locationTimelineChart(timeline, "light");

    expect(series.map(s => s.label)).toEqual(["Germany", "Canada", "France", "Canada", "France"]);
  });

  it("has nothing to draw without stays", () => {
    expect(locationTimelineChart([], "light")).toEqual({ series: [], legend: [] });
  });
});

describe("the location timeline's colours", () => {
  it("gives a place one colour on every stay and names it once in the legend", () => {
    const { series, legend } = locationTimelineChart(timeline, "light");

    const colorOf = (place: string) => new Set(series.filter(s => s.label === place).map(s => s.color));
    expect(colorOf("Canada").size).toBe(1);
    expect(colorOf("France").size).toBe(1);
    // In the bar's order: each place where its first stay is
    expect(legend.map(entry => entry.label)).toEqual(["Germany", "Canada", "France"]);
    expect(new Set(legend.map(entry => entry.color)).size).toBe(3);
  });

  it("gives the place with the most time the accent itself", () => {
    const { legend } = locationTimelineChart(timeline, "light");

    expect(legend.find(entry => entry.label === "Germany")?.color).toBe("var(--mantine-primary-color-6)");
    expect(legend.every(entry => entry.color.startsWith("var(--mantine-primary-color-"))).toBe(true);
    // The dark scheme's accent is its pastel step
    expect(locationTimelineChart(timeline, "dark").legend[0]?.color).toBe("var(--mantine-primary-color-2)");
  });

  it("groups the places past the palette as Other", () => {
    const places = Array.from({ length: 8 }, (_unused, i) => ({
      loc: `Place ${i}`,
      data: [100 - i],
      color: "#0",
      start: i,
      end: i + 1,
    }));
    const { series, legend } = locationTimelineChart(places, "dark");

    // Five steps of the accent, then one grey for the rest
    expect(legend).toHaveLength(6);
    expect(legend.at(-1)?.label).toBeNull();
    const other = defined(legend.at(-1)).color;
    expect(other).not.toContain("primary");
    expect(series.slice(5).every(s => s.color === other)).toBe(true);
    expect(series.slice(0, 5).some(s => s.color === other)).toBe(false);
  });
});
