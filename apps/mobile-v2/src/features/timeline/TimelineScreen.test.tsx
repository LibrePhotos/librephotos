import { waitFor } from "@testing-library/react-native";
import { TimelineScreen } from "./TimelineScreen";
import { useSettingsStore } from "@/stores/settings";
import { jsonResponse, makeMockClient, renderWithProviders } from "@/test/test-utils";

const RECENTLY_ADDED = {
  date: "2024-06-15",
  results: [
    { id: "11111111-1111-1111-1111-111111111111", image_hash: "hashA", aspectRatio: 1.5, type: "image", rating: 0 },
    { id: "22222222-2222-2222-2222-222222222222", image_hash: "hashB", aspectRatio: 1, type: "video", rating: 0 },
  ],
};

describe("TimelineScreen", () => {
  beforeEach(() => {
    useSettingsStore.setState({ serverUrl: "https://test.local" });
  });

  it("fetches the timeline via the api-client hook and renders a photo grid", async () => {
    const client = makeMockClient(async (url) => {
      if (url.includes("/photos/recentlyadded/")) return jsonResponse(RECENTLY_ADDED);
      return jsonResponse({}, 404);
    });

    const { getByTestId } = renderWithProviders(<TimelineScreen />, client);

    expect(getByTestId("timeline-title")).toBeTruthy();

    // Grid items appear once the query resolves.
    await waitFor(() => {
      expect(getByTestId("photo-hashA")).toBeTruthy();
      expect(getByTestId("thumb-hashA")).toBeTruthy();
      expect(getByTestId("photo-hashB")).toBeTruthy();
    });
  });
});
