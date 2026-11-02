import { NO_TIMELINE_FILTER } from "@/db/queries/timeline";
import { fromServerDefault, sameFilter, toServerDefault, useTimelineFilterStore } from "./timelineFilter";

describe("timeline filter default", () => {
  it("reads the web's saved default", () => {
    expect(fromServerDefault({ media: "photos", hide_screenshots: true })).toEqual({
      media: "photos",
      favorites: false,
      hideScreenshots: true,
      hideDocuments: false,
    });
    expect(fromServerDefault(undefined)).toEqual(NO_TIMELINE_FILTER);
    expect(fromServerDefault({})).toEqual(NO_TIMELINE_FILTER);
  });

  it("saves only what differs from showing everything", () => {
    expect(toServerDefault(NO_TIMELINE_FILTER)).toEqual({});
    expect(toServerDefault({ media: "videos", favorites: true, hideScreenshots: false, hideDocuments: true })).toEqual({
      media: "videos",
      favorites: true,
      hide_documents: true,
    });
  });

  it("round-trips", () => {
    const filter = { media: "photos" as const, favorites: true, hideScreenshots: true, hideDocuments: false };
    expect(sameFilter(fromServerDefault(toServerDefault(filter)), filter)).toBe(true);
  });
});

describe("useTimelineFilterStore", () => {
  beforeEach(() => useTimelineFilterStore.setState({ filter: NO_TIMELINE_FILTER, touched: false }));

  it("adopts the saved default until the user picks a filter", () => {
    const saved = { ...NO_TIMELINE_FILTER, favorites: true };
    useTimelineFilterStore.getState().adoptDefault(saved);
    expect(useTimelineFilterStore.getState().filter).toEqual(saved);

    const picked = { ...NO_TIMELINE_FILTER, media: "videos" as const };
    useTimelineFilterStore.getState().setFilter(picked);
    useTimelineFilterStore.getState().adoptDefault(saved);
    expect(useTimelineFilterStore.getState().filter).toEqual(picked);
  });
});
