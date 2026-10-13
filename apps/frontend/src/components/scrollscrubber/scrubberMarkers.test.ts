/**
 * The scrubber's markers (moved out of ScrollScrubber.tsx): one per label, first letter, year or
 * month, and none closer than a marker chip's height to the previous one.
 */
import { UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import type { ScrollerPosition } from "./scrollScrubberTypes";
import { alphabetMarkers, dateMarkers, labelMarkers } from "./scrubberMarkers";

const at = (label: string, scrollerY: number, year?: number, month?: string): ScrollerPosition => ({
  label,
  targetY: scrollerY * 10,
  scrollerY,
  scrollerYPercent: scrollerY / 10,
  year,
  month,
});

const labels = (markers: ScrollerPosition[]) => markers.map(marker => marker.label);

describe("labelMarkers", () => {
  it("keeps a label only past the previous marker's chip", () => {
    expect(labels(labelMarkers([at("one", 0), at("two", 20), at("three", 41)]))).toEqual(["one", "three"]);
  });

  it("copies only the position into a marker", () => {
    expect(labelMarkers([{ ...at("Anna", 30), year: 2024, month: "Jan 2024" }])).toEqual([
      { label: "Anna", targetY: 300, scrollerY: 30, scrollerYPercent: 3 },
    ]);
  });
});

describe("alphabetMarkers", () => {
  it("marks where the first letter changes, and spells out the unknown group", () => {
    const positions = [
      at("Anna", 0),
      at("Alex", 30),
      at("Bruno", 60),
      at("bea", 90),
      at(UNKNOWN_PERSON_NAME, 120),
      at("Zoe", 125),
      at("Ümit", 200),
    ];
    expect(labels(alphabetMarkers(positions))).toEqual(["A", "B", UNKNOWN_PERSON_NAME, "U"]);
  });
});

describe("dateMarkers", () => {
  it("marks each year when there are ten or more", () => {
    const positions = Array.from({ length: 10 }, (_, i) => at(`day ${i}`, i * 30, 2010 + i, `Jan ${2010 + i}`));
    expect(labels(dateMarkers(positions))).toEqual(positions.map(position => String(position.year)));
  });

  it("marks months when there are fewer years", () => {
    const positions = [
      at("a", 0, 2024, "Jan 2024"),
      at("b", 30, 2024, "Jan 2024"),
      at("c", 60, 2024, "Feb 2024"),
      at("d", 90, 2025, "Mar 2025"),
    ];
    expect(labels(dateMarkers(positions))).toEqual(["Jan 2024", "Feb 2024", "Mar 2025"]);
  });

  it("falls back to the labels when everything is in one month", () => {
    const positions = [at("Mon 1", 0, 2024, "Jan 2024"), at("Tue 2", 30, 2024, "Jan 2024")];
    expect(labels(dateMarkers(positions))).toEqual(["Mon 1", "Tue 2"]);
  });

  it("uses a position's own label when it has no date", () => {
    expect(labels(dateMarkers([at("Undated", 0), at("Also undated", 30)]))).toEqual(["Undated", "Also undated"]);
  });
});
