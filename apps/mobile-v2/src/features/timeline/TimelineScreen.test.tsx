import { waitFor } from "@testing-library/react-native";
import { TimelineScreen } from "./TimelineScreen";
import { useSettingsStore } from "@/stores/settings";
import { renderWithDb } from "@/test/test-utils";
import { createTestDb, type TestDb } from "@/db/test-db";
import { remotePhoto, seedRemotePhotos } from "@/db/__tests__/fixtures";

const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

describe("TimelineScreen (SQLite live query)", () => {
  let t: TestDb;
  beforeEach(() => {
    useSettingsStore.setState({ serverUrl: "https://test.local" });
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("renders day headers + tiles from the seeded mirror", async () => {
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "a", imageHash: "hashA", timestamp: D(2024, 1, 3), bucketDay: "2024-01-03" }),
      remotePhoto({ id: "b", imageHash: "hashB", timestamp: D(2024, 1, 2), bucketDay: "2024-01-02", type: "video" }),
    ]);

    const { getByTestId } = renderWithDb(<TimelineScreen />, t.db);

    expect(getByTestId("timeline-title")).toBeTruthy();
    await waitFor(() => {
      expect(getByTestId("section-2024-01-03")).toBeTruthy();
      expect(getByTestId("tile-a")).toBeTruthy();
      expect(getByTestId("tile-b")).toBeTruthy();
      expect(getByTestId("video-badge-b")).toBeTruthy();
    });
  });

  it("shows the empty state when the mirror has no photos", async () => {
    const { getByTestId } = renderWithDb(<TimelineScreen />, t.db);
    await waitFor(() => expect(getByTestId("timeline-empty")).toBeTruthy());
  });
});
