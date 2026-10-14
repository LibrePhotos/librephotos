/**
 * The chips under the search title read as sentences, in the panel's order, and each one carries
 * the patch that removes just that filter (one person out of several, both ends of a range).
 */
import { Settings } from "luxon";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { describeSearchFilters, type ChipContext } from "./searchFilterLabels";

const originalLocale = Settings.defaultLocale;

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterEach(() => {
  Settings.defaultLocale = originalLocale;
});

const NAMES: Record<number, string> = { 3: "Anna", 7: "Jonas" };

function context(favoriteRating?: number): ChipContext {
  return { t: i18n.t, language: "en-US", personName: id => NAMES[id], favoriteRating };
}

describe("describeSearchFilters", () => {
  it("says nothing without filters", () => {
    expect(describeSearchFilters({}, context())).toEqual([]);
  });

  it("writes each filter as a sentence, people first", () => {
    Settings.defaultLocale = "en-US";
    const chips = describeSearchFilters(
      {
        person: [3, 99],
        make: "FUJIFILM",
        camera: "X-T5",
        lens: "XF23mmF1.4 R",
        iso_min: 3200,
        aperture_min: 1.4,
        aperture_max: 2,
        focal_max: 35,
        focal35_min: 24,
        focal35_max: 70,
        rating_min: 4,
        taken_after: "2024-03-01",
        taken_before: "2024-05-31",
        has_location: false,
        file_type: "raw",
        extension: "cr3",
      },
      context()
    );
    expect(chips.map(chip => chip.label)).toEqual([
      "With Anna",
      "With a person not in your list",
      "Maker: FUJIFILM",
      "Camera: X-T5",
      "Lens: XF23mmF1.4 R",
      "ISO 3,200 or more",
      "Aperture f/1.4 to f/2",
      "Focal length up to 35 mm",
      "35 mm equivalent 24 mm to 70 mm",
      "4 stars or more",
      "Taken Mar 1, 2024 to May 31, 2024",
      "No location",
      "Has a RAW file",
      ".cr3 files",
    ]);
    expect(chips[0]?.personId).toBe(3);
  });

  it("removes one person and keeps the others", () => {
    const [anna, jonas] = describeSearchFilters({ person: [3, 7] }, context());
    expect(anna?.patch).toEqual({ person: [7] });
    expect(jonas?.patch).toEqual({ person: [3] });
    const [alone] = describeSearchFilters({ person: [3] }, context());
    expect(alone?.patch).toEqual({ person: undefined });
  });

  it("removes both ends of a range and of a day span", () => {
    const chips = describeSearchFilters({ iso_max: 800, taken_before: "2024-01-31" }, context());
    expect(chips.map(chip => chip.patch)).toEqual([
      { iso_min: undefined, iso_max: undefined },
      { taken_after: undefined, taken_before: undefined },
    ]);
    expect(chips.map(chip => chip.label)).toEqual(["ISO up to 800", "Taken on or before Jan 31, 2024"]);
  });

  it("calls the favorite threshold Favorites only in the favorite rating mode", () => {
    expect(describeSearchFilters({ rating_min: 4 }, context(4))[0]?.label).toBe("Favorites only");
    // Another rating (a link from a stars user) still says what it asks for.
    expect(describeSearchFilters({ rating_min: 1 }, context(4))[0]?.label).toBe("1 star or more");
  });

  it("names the other location and file choices", () => {
    const chips = describeSearchFilters({ has_location: true, file_type: "video" }, context());
    expect(chips.map(chip => chip.label)).toEqual(["Has location", "Main file is a video"]);
  });
});
