import {
  dayAtFraction,
  estimatedRows,
  fractionOfDay,
  monthLabel,
  photosBefore,
  scrubberIndex,
  spacedMarks,
  yearMarks,
} from "./scrubberMath";

const buckets = [
  { bucket_day: "2021-02-27", count: 2 },
  { bucket_day: "2021-01-09", count: 6 },
  { bucket_day: "2019-09-11", count: 2 },
];

describe("scrubber math", () => {
  const index = scrubberIndex(buckets);

  it("gives each day space in proportion to its photos", () => {
    expect(index.total).toBe(10);
    expect(index.starts).toEqual([0, 0.2, 0.8, 1]);
    expect(index.before).toEqual([0, 2, 8]);
  });

  it("finds the day under a point of the track", () => {
    expect(dayAtFraction(index, 0)).toBe("2021-02-27");
    expect(dayAtFraction(index, 0.19)).toBe("2021-02-27");
    expect(dayAtFraction(index, 0.2)).toBe("2021-01-09");
    expect(dayAtFraction(index, 0.79)).toBe("2021-01-09");
    expect(dayAtFraction(index, 1)).toBe("2019-09-11");
    expect(dayAtFraction(index, -3)).toBe("2021-02-27");
    expect(dayAtFraction(index, 7)).toBe("2019-09-11");
  });

  it("maps a day back to the track and to the photos before it", () => {
    expect(fractionOfDay(index, "2021-01-09")).toBe(0.2);
    expect(fractionOfDay(index, "1999-01-01")).toBe(0);
    expect(fractionOfDay(index, null)).toBe(0);
    expect(photosBefore(index, "2019-09-11")).toBe(8);
  });

  it("marks the first day of each year", () => {
    expect(yearMarks(index)).toEqual([
      { year: "2021", fraction: 0 },
      { year: "2019", fraction: 0.8 },
    ]);
  });

  it("handles an empty library", () => {
    const empty = scrubberIndex([]);
    expect(dayAtFraction(empty, 0.5)).toBeNull();
    expect(yearMarks(empty)).toEqual([]);
  });

  it("estimates the list length from days and photo rows", () => {
    // 1 header + 1 row, 1 header + 2 rows, 1 header + 1 row.
    expect(estimatedRows(buckets)).toBe(7);
    expect(estimatedRows([])).toBe(0);
  });

  it("drops year marks that would print on top of each other", () => {
    const marks = [
      { year: "2021", fraction: 0 },
      { year: "2019", fraction: 0.1 },
      { year: "2018", fraction: 0.12 },
      { year: "2011", fraction: 0.9 },
    ];
    expect(spacedMarks(marks, 200).map((m) => m.year)).toEqual(["2021", "2019", "2011"]);
  });

  it("labels a day with its month and year", () => {
    expect(monthLabel("2021-02-27", "en-US")).toBe("Feb 2021");
  });
});
