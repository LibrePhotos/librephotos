import { fireEvent, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { ShareSheet } from "./ShareSheet";
import { renderWithProviders, makeMockClient, jsonResponse } from "@/test/test-utils";
import { useAuthStore } from "@/stores/auth";
import { useToastStore } from "@/stores/toasts";
import { useSettingsStore } from "@/stores/settings";
// A complete, schema-valid self-user (drives the public-link username).
import SELF_USER from "../../../../../packages/api-client/src/__tests__/fixtures/user.json";

const USERS = [
  { id: 1, username: "admin", first_name: "Me", last_name: "", public_photo_count: 0, public_photo_samples: [] },
  { id: 2, username: "bob", first_name: "Bob", last_name: "R", public_photo_count: 0, public_photo_samples: [] },
];

describe("ShareSheet", () => {
  beforeEach(() => {
    useAuthStore.setState({ userId: 1 });
    useToastStore.setState({ toasts: [] });
    useSettingsStore.setState({ serverUrl: "https://demo.local" });
    jest.clearAllMocks();
  });

  it("shares selected photos with a chosen user", async () => {
    const calls: string[] = [];
    const client = makeMockClient(async (url, init) => {
      calls.push(url);
      if (url.includes("/user/1/")) return jsonResponse(SELF_USER);
      if (url.endsWith("/user/")) return jsonResponse(USERS);
      if (url.includes("/photosedit/share/")) {
        void init;
        return jsonResponse({ status: true, count: 1 });
      }
      return jsonResponse({}, 404);
    });

    const onClose = jest.fn();
    const { getByTestId } = renderWithProviders(
      <ShareSheet visible imageHashes={["h1", "h2"]} onClose={onClose} />,
      client
    );

    fireEvent.press(getByTestId("share-with-person"));
    await waitFor(() => expect(getByTestId("user-pick-2")).toBeTruthy());
    fireEvent.press(getByTestId("user-pick-2"));

    await waitFor(() => expect(calls.some((u) => u.includes("/photosedit/share/"))).toBe(true));
    expect(useToastStore.getState().toasts.at(-1)?.level).toBe("info");
  });

  it("makes photos public and copies the gallery link", async () => {
    const client = makeMockClient(async (url) => {
      if (url.includes("/user/1/")) return jsonResponse(SELF_USER);
      if (url.includes("/photosedit/makepublic/")) return jsonResponse({ status: true });
      return jsonResponse({}, 404);
    });

    const { getByTestId } = renderWithProviders(
      <ShareSheet visible imageHashes={["h1"]} onClose={jest.fn()} />,
      client
    );

    // Retry the press until the self query resolves and the link is copied.
    await waitFor(() => {
      fireEvent.press(getByTestId("share-public-link"));
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith("https://demo.local/public/admin");
    });
  });
});
