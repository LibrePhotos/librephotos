import { describe, expect, it } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { locationTimelineChart, stayForSeries } from "./locationTimelineChart";

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
  it("keeps every stay as its own segment with its own duration", () => {
    const { data, series } = locationTimelineChart(timeline);

    expect(new Set(series.map(s => s.name)).size).toBe(5);
    expect(series.map(s => s.label)).toEqual(["Germany", "Canada", "France", "Canada", "France"]);
    expect(series.map(s => data[0]?.[s.name])).toEqual([22208418, 9413609, 20648022, 6132785, 79828]);
  });

  it("finds the stay behind a hovered segment", () => {
    const { series } = locationTimelineChart(timeline);

    expect(stayForSeries(timeline, defined(series[1]).name)?.start).toBe(2);
    expect(stayForSeries(timeline, defined(series[3]).name)?.start).toBe(6);
  });

  it("has no data row without stays", () => {
    expect(locationTimelineChart([])).toEqual({ data: [], series: [], legend: [] });
  });
});

describe("the location timeline's colours", () => {
  it("gives a place one colour on every stay and names it once in the legend", () => {
    const { series, legend } = locationTimelineChart(timeline);

    const colorOf = (place: string) => new Set(series.filter(s => s.label === place).map(s => s.color));
    expect(colorOf("Canada").size).toBe(1);
    expect(colorOf("France").size).toBe(1);
    // The places with the most time first
    expect(legend.map(entry => entry.label)).toEqual(["Germany", "France", "Canada"]);
    expect(new Set(legend.map(entry => entry.color)).size).toBe(3);
  });

  it("groups the places past the palette as Other", () => {
    const places = Array.from({ length: 11 }, (_unused, i) => ({
      loc: `Place ${i}`,
      data: [100 - i],
      color: "#0",
      start: i,
      end: i + 1,
    }));
    const { series, legend } = locationTimelineChart(places);

    expect(legend).toHaveLength(9);
    expect(legend.at(-1)?.label).toBeNull();
    const other = defined(legend.at(-1)).color;
    expect(series.slice(8).every(s => s.color === other)).toBe(true);
    expect(series.slice(0, 8).some(s => s.color === other)).toBe(false);
  });
});
