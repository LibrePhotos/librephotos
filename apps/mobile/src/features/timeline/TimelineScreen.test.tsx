import { fireEvent, waitFor } from "@testing-library/react-native";
import { NO_TIMELINE_FILTER } from "@librephotos/local-db";
import { useTimelineFilterStore } from "./timelineFilter";
import { DEFAULT_DENSITY_LEVEL, useDensityStore } from "./density";
import { TimelineScreen } from "./TimelineScreen";
import { useSettingsStore } from "@/stores/settings";
import { renderWithDb, settleDb } from "@/test/test-utils";
import { createTestDb, remotePhoto, seedRemotePhotos, type TestDb } from "@librephotos/local-db/testing";

const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

describe("TimelineScreen (SQLite live query)", () => {
  let t: TestDb;
  beforeEach(() => {
    useSettingsStore.setState({ serverUrl: "https://test.local" });
    t = createTestDb();
    useTimelineFilterStore.setState({ filter: NO_TIMELINE_FILTER, touched: false });
    useDensityStore.setState({ level: DEFAULT_DENSITY_LEVEL });
  });
  afterEach(() => t.close());

  it("renders day headers + tiles from the seeded mirror", async () => {
    await seedRemotePhotos(t.db, [
      remotePhoto({ id: "a", imageHash: "hashA", timestamp: D(2024, 1, 3), bucketDay: "2024-01-03" }),
      remotePhoto({ id: "b", imageHash: "hashB", timestamp: D(2024, 1, 2), bucketDay: "2024-01-02", type: "video" }),
    ]);

    const { getByTestId } = await renderWithDb(<TimelineScreen />, t.db);

    // No title bar: the screen starts with the photos and the floating buttons.
    expect(getByTestId("timeline-screen")).toBeTruthy();
    expect(getByTestId("timeline-filter-button")).toBeTruthy();
    expect(getByTestId("account-button")).toBeTruthy();
    await waitFor(() => {
      expect(getByTestId("section-2024-01-03")).toBeTruthy();
      expect(getByTestId("tile-a")).toBeTruthy();
      expect(getByTestId("tile-b")).toBeTruthy();
      expect(getByTestId("video-badge-b")).toBeTruthy();
    });
  });

  it("shows the empty state when the mirror has no photos", async () => {
    const { getByTestId } = await renderWithDb(<TimelineScreen />, t.db);
    await waitFor(() => expect(getByTestId("timeline-empty")).toBeTruthy());
  });

  it("filters the timeline from the filter sheet, offline", async () => {
    await seedRemotePhotos(t.db, [
      remotePhoto({ id: "a", imageHash: "hashA", timestamp: D(2024, 1, 3), bucketDay: "2024-01-03" }),
      remotePhoto({ id: "b", imageHash: "hashB", timestamp: D(2024, 1, 2), bucketDay: "2024-01-02", type: "video" }),
    ]);
    const { getByTestId, queryByTestId } = await renderWithDb(<TimelineScreen />, t.db);
    await waitFor(() => expect(getByTestId("tile-b")).toBeTruthy());

    fireEvent.press(getByTestId("timeline-filter-button"));

    await settleDb();
    fireEvent.press(getByTestId("timeline-filter-media-videos"));
    await settleDb();

    await waitFor(() => {
      expect(queryByTestId("tile-a")).toBeNull();
      expect(getByTestId("tile-b")).toBeTruthy();
    });

    fireEvent.press(getByTestId("timeline-filter-reset"));

    await settleDb();
    await waitFor(() => expect(getByTestId("tile-a")).toBeTruthy());
  });

  it("groups by month or year from the grid switch", async () => {
    await seedRemotePhotos(t.db, [
      remotePhoto({ id: "a", imageHash: "hashA", timestamp: D(2024, 1, 3), bucketDay: "2024-01-03" }),
      remotePhoto({ id: "b", imageHash: "hashB", timestamp: D(2024, 1, 2), bucketDay: "2024-01-02" }),
      remotePhoto({ id: "c", imageHash: "hashC", timestamp: D(2023, 5, 2), bucketDay: "2023-05-02" }),
    ]);
    const { getByTestId, queryByTestId } = await renderWithDb(<TimelineScreen />, t.db);
    await waitFor(() => expect(getByTestId("section-2024-01-03")).toBeTruthy());

    fireEvent.press(getByTestId("timeline-filter-button"));

    await settleDb();
    fireEvent.press(getByTestId("timeline-density-2"));
    await settleDb();
    await waitFor(() => {
      expect(getByTestId("section-2024-01")).toBeTruthy();
      expect(queryByTestId("section-2024-01-03")).toBeNull();
    });

    fireEvent.press(getByTestId("timeline-density-3"));

    await settleDb();
    await waitFor(() => {
      expect(getByTestId("section-2024")).toBeTruthy();
      expect(getByTestId("section-2023")).toBeTruthy();
    });
    expect(useDensityStore.getState().level).toBe(3);
  });
});
