import { waitFor } from "@testing-library/react-native";
import { ProfileScreen } from "./ProfileScreen";
import { renderWithDb, makeMockClient, jsonResponse } from "@/test/test-utils";
import { createTestDb, remotePhoto, seedRemotePhotos, type TestDb } from "@librephotos/local-db/testing";
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";
import SELF_USER from "../../../../../packages/api-client/src/__tests__/fixtures/user.json";

function client(isSuperuser: boolean) {
  return makeMockClient(async (url) => {
    if (url.includes("/user/1/")) return jsonResponse({ ...SELF_USER, is_superuser: isSuperuser });
    return jsonResponse({}, 404);
  });
}

describe("ProfileScreen", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    useAuthStore.setState({ userId: 1 });
    useSettingsStore.setState({ serverUrl: "https://demo.local" });
  });
  afterEach(() => t.close());

  it("renders identity, stats, and navigation rows", async () => {
    await seedRemotePhotos(t.db, [remotePhoto({ id: "p1", imageHash: "h1" })]);
    const { getByTestId } = await renderWithDb(<ProfileScreen />, t.db, client(false));

    await waitFor(() => {
      expect(getByTestId("profile-username")).toBeTruthy();
      expect(getByTestId("stats-card")).toBeTruthy();
      expect(getByTestId("profile-settings-link")).toBeTruthy();
      expect(getByTestId("profile-faces-link")).toBeTruthy();
    });
  });

  it("shows the server (admin) row only for superusers", async () => {
    const { getByTestId, queryByTestId } = await renderWithDb(<ProfileScreen />, t.db, client(true));
    await waitFor(() => expect(getByTestId("profile-server-link")).toBeTruthy());

    const nonAdmin = await renderWithDb(<ProfileScreen />, t.db, client(false));
    await waitFor(() => expect(nonAdmin.getByTestId("profile-username")).toBeTruthy());
    expect(nonAdmin.queryByTestId("profile-server-link")).toBeNull();
    void queryByTestId;
  });
});
