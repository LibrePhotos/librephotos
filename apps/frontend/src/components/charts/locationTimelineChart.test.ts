import { describe, expect, it } from "vitest";
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
    expect(series.map(s => data[0][s.name])).toEqual([22208418, 9413609, 20648022, 6132785, 79828]);
  });

  it("finds the stay behind a hovered segment", () => {
    const { series } = locationTimelineChart(timeline);

    expect(stayForSeries(timeline, series[1].name).start).toBe(2);
    expect(stayForSeries(timeline, series[3].name).start).toBe(6);
  });

  it("has no data row without stays", () => {
    expect(locationTimelineChart([])).toEqual({ data: [], series: [] });
  });
});
