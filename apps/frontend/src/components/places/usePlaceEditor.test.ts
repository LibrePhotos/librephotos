import type { UserPlace } from "@librephotos/api-client";
import { describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { circleTooSmall, revealCircle, type FitMap } from "../map/revealCircle";
import { addPlaceBlocked, editorStateOf } from "./usePlaceEditor";

const home: UserPlace = {
  id: 3,
  name: "Home",
  icon: "home",
  center_lat: 48.1,
  center_lon: 11.5,
  radius_m: 150,
  use_in_titles: false,
  photo_count: 2,
  cover_photos: [],
};

describe("editorStateOf", () => {
  it("starts the editor on a place as it is", () => {
    expect(editorStateOf(home)).toEqual({
      id: 3,
      center: { lat: 48.1, lon: 11.5 },
      radiusM: 150,
      name: "Home",
      icon: "home",
      useInTitles: false,
    });
  });
});

describe("addPlaceBlocked", () => {
  const t = i18n.getFixedT("en");

  it("says why a place cannot be added", () => {
    expect(addPlaceBlocked(t, true, false)).toBe(t("yourplaces.mapsOff"));
    expect(addPlaceBlocked(t, false, true)).toBe(t("yourplaces.drawing"));
    expect(addPlaceBlocked(t, false, false)).toBeNull();
  });
});

describe("circleTooSmall", () => {
  it("asks for a zoom when the circle would be a few pixels wide", () => {
    // 150 m at zoom 10 is about one pixel; at zoom 17 about 120
    expect(circleTooSmall({ lat: 48.1, lon: 11.5 }, 150, 10)).toBe(true);
    expect(circleTooSmall({ lat: 48.1, lon: 11.5 }, 150, 17)).toBe(false);
  });
});

describe("revealCircle", () => {
  function stubMap(zoom: number) {
    const fitBounds = vi.fn<FitMap["fitBounds"]>();
    const map: FitMap = { getZoom: () => zoom, fitBounds };
    return { map, fitBounds };
  }

  it("zooms in on a circle too small to draw on, and leaves a visible one alone", () => {
    const far = stubMap(10);
    revealCircle(far.map, { lat: 48.1, lon: 11.5 }, 150);
    expect(far.fitBounds).toHaveBeenCalledTimes(1);
    const near = stubMap(17);
    revealCircle(near.map, { lat: 48.1, lon: 11.5 }, 150);
    expect(near.fitBounds).not.toHaveBeenCalled();
  });
});
