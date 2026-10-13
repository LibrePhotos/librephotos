import type { DatePhotosGroup, DirTree } from "@librephotos/api-client";
import { Settings } from "luxon";
import i18n from "../i18n";
import { defined } from "./defined.test-utils";
import {
  formatDateForPhotoGroups,
  fuzzyMatch,
  getAveragedCoordinates,
  LEGACY_UNDATED_GROUP_DATE,
  mergeDirTree,
} from "./util";

describe("fuzzyMatch", () => {
  test("matches", () => {
    const matches = [
      { value: "Dinosaur", query: "Dinosaur", result: true },
      { value: "Kraken", query: "KRAKEN", result: true },
      { value: "ELEPHANT", query: "elephant", result: true },
      { value: "Dinosaur", query: "dino", result: true },
      { value: "Dinosaur", query: "saur", result: true },
      { value: "Dinosaur", query: "INO", result: true },
      { value: "Dino saur", query: "nosa", result: true },
      { value: "var{var}", query: "{var", result: true },
      { value: "$dollar", query: "$dol", result: true },
      { value: "many*many", query: "many*m", result: true },
      { value: "what's up?", query: "what?", result: true },
      { value: "Dinosaur", query: "abr", result: false },
      { value: "Dinosaur", query: "sauron", result: false },
      { value: "what?", query: "what's up?", result: false },
      { value: "asdf", query: "asf", result: true },
      { value: "asdf", query: "asff", result: false },
    ];

    matches.forEach(item => {
      expect(fuzzyMatch(item.query, item.value)).toBe(item.result);
    });
  });

  // A space typed first in a search box threw "Reduce of empty array with no
  // initial value" and crashed the component.
  test("matches everything for a whitespace-only query, like an empty one", () => {
    expect(fuzzyMatch("", "Dinosaur")).toBe(true);
    expect(fuzzyMatch(" ", "Dinosaur")).toBe(true);
    expect(fuzzyMatch(" 	 ", "Dinosaur")).toBe(true);
  });

  test("ignores whitespace inside the query", () => {
    expect(fuzzyMatch(" di no ", "Dinosaur")).toBe(true);
    expect(fuzzyMatch("d x", "Dinosaur")).toBe(false);
  });
});

test("merge directory tree", () => {
  const tree: DirTree[] = [
    {
      title: "root",
      absolute_path: "/",
      children: [
        {
          title: "dir1",
          absolute_path: "/dir1",
          children: [
            {
              title: "dir1-1",
              absolute_path: "/dir1/dir1-1",
              children: [],
            },
          ],
        },
        {
          title: "dir2",
          absolute_path: "/dir2",
          children: [],
        },
      ],
    },
  ];
  const branch: DirTree = {
    title: "dir1-1",
    absolute_path: "/dir1/dir1-1",
    children: [
      {
        title: "dir1-1-1",
        absolute_path: "/dir1/dir1-1/dir1-1-1",
        children: [
          {
            title: "dir1-1-1-1",
            absolute_path: "/dir1/dir1-1/dir1-1-1/dir1-1-1-1",
            children: [],
          },
        ],
      },
    ],
  };
  const expected: DirTree[] = [
    {
      title: "root",
      absolute_path: "/",
      children: [
        {
          title: "dir1",
          absolute_path: "/dir1",
          children: [
            {
              title: "dir1-1",
              absolute_path: "/dir1/dir1-1",
              children: [
                {
                  title: "dir1-1-1",
                  absolute_path: "/dir1/dir1-1/dir1-1-1",
                  children: [
                    {
                      title: "dir1-1-1-1",
                      absolute_path: "/dir1/dir1-1/dir1-1-1/dir1-1-1-1",
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          title: "dir2",
          absolute_path: "/dir2",
          children: [],
        },
      ],
    },
  ];

  expect(mergeDirTree(tree, branch)).toEqual(expected);
});

describe("adjust date for photo list group", () => {
  test("should format date, set year and month", () => {
    const photoGroups: DatePhotosGroup[] = [
      {
        date: "2023-03-03",
        location: "",
        items: [],
      },
      {
        date: "2023-05-06",
        location: "",
        items: [],
      },
    ];
    const actual = formatDateForPhotoGroups(photoGroups);
    expect(defined(actual[0], "the first group").date).toEqual("Friday, March 3, 2023");
    expect(defined(actual[0], "the first group").year).toEqual(2023);
    expect(defined(actual[0], "the first group").month).toEqual(3);
    expect(defined(actual[1], "the second group").date).toEqual("Saturday, May 6, 2023");
    expect(defined(actual[1], "the second group").year).toEqual(2023);
    expect(defined(actual[1], "the second group").month).toEqual(5);
  });

  it("keeps the camera's day for viewers east of UTC", () => {
    // Group dates are wall-clock exif_timestamps tagged as UTC; 23:05 must not
    // roll over to the next day in Berlin.
    const previousZone = Settings.defaultZone;
    Settings.defaultZone = "Europe/Berlin";
    try {
      const actual = formatDateForPhotoGroups([{ date: "2024-04-02T23:05:00Z", location: "", items: [] }]);
      expect(defined(actual[0], "the first group").date).toEqual("Tuesday, April 2, 2024");
      expect(defined(actual[0], "the first group").month).toEqual(4);
    } finally {
      Settings.defaultZone = previousZone;
    }
  });

  it("should return original date if it is not valid", () => {
    const photoGroups: DatePhotosGroup[] = [
      {
        date: "invalid date",
        location: "",
        items: [],
      },
    ];
    const actual = formatDateForPhotoGroups(photoGroups);
    expect(actual).toEqual(photoGroups);
  });

  it("should return localised string if date is null", () => {
    const photoGroups: DatePhotosGroup[] = [
      {
        date: null,
        location: "",
        items: [],
      },
    ];
    const actual = formatDateForPhotoGroups(photoGroups);
    expect(defined(actual[0], "the first group").date).toEqual(i18n.t("sidemenu.withouttimestamp"));
  });

  // Search still sends this English literal for installed mobile apps; it was
  // shown as is, in every language and unlike "Without Timestamp" elsewhere.
  it("labels the search endpoint's legacy undated group the same way", () => {
    const actual = formatDateForPhotoGroups([{ date: LEGACY_UNDATED_GROUP_DATE, location: "", items: [] }]);
    expect(defined(actual[0], "the first group").date).toEqual(i18n.t("sidemenu.withouttimestamp"));
    expect(defined(actual[0], "the first group").year).toBeUndefined();
  });
});

describe("getAveragedCoordinates", () => {
  test("should return average coordinates", () => {
    const actual = getAveragedCoordinates([
      { id: "1", exif_gps_lat: 1, exif_gps_lon: 2 },
      { id: "2", exif_gps_lat: 3, exif_gps_lon: 4 },
      { id: "3", exif_gps_lat: -3, exif_gps_lon: 6 },
      { id: "4", exif_gps_lat: 2, exif_gps_lon: 1 },
    ]);
    expect(actual).toEqual({ avgLat: 0.75, avgLon: 3.25 });
  });
});
