import { fireEvent, waitFor } from "@testing-library/react-native";
import { FaceTaggingScreen } from "./FaceTaggingScreen";
import { faceImageUrl } from "./faceImage";
import { renderWithDb, makeMockClient, jsonResponse } from "@/test/test-utils";
import { createTestDb, type TestDb } from "@/db/test-db";
import { useToastStore } from "@/stores/toasts";

function facesResponse(results: unknown[]) {
  return { count: results.length, next: null, previous: null, results };
}

const INFERRED = facesResponse([
  { id: 10, face_url: "/media/faces/10.jpg", person: 3, person_name: "Alice", person_label_probability: 0.9 },
]);
const UNKNOWN = facesResponse([{ id: 20, face_url: "/media/faces/20.jpg", person: null }]);

function client(onLabel?: (body: unknown) => void) {
  return makeMockClient(async (url, init) => {
    if (url.includes("/faces/?") && url.includes("inferred=true")) return jsonResponse(INFERRED);
    if (url.includes("/faces/?") && url.includes("inferred=false")) return jsonResponse(UNKNOWN);
    if (url.endsWith("/labelfaces")) {
      onLabel?.(JSON.parse(String(init?.body)));
      return jsonResponse({ status: true, results: [], updated: [], not_updated: [] });
    }
    return jsonResponse({}, 404);
  });
}

describe("faceImageUrl", () => {
  it("prepends the server origin to a relative path", () => {
    expect(faceImageUrl("https://s.local", { face_url: "/media/faces/1.jpg", image: null })).toBe(
      "https://s.local/media/faces/1.jpg"
    );
  });
  it("passes absolute URLs through and handles missing paths", () => {
    expect(faceImageUrl("https://s.local", { face_url: "https://cdn/x.jpg", image: null })).toBe("https://cdn/x.jpg");
    expect(faceImageUrl("https://s.local", { face_url: null, image: null })).toBeNull();
  });
});

describe("FaceTaggingScreen", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    useToastStore.setState({ toasts: [] });
    (globalThis as { __mockNetworkConnected?: boolean }).__mockNetworkConnected = true;
  });
  afterEach(() => t.close());

  it("accepts an inferred face with its suggested name", async () => {
    let body: unknown;
    const { getByTestId } = renderWithDb(<FaceTaggingScreen />, t.db, client((b) => (body = b)));

    await waitFor(() => expect(getByTestId("face-accept-10")).toBeTruthy());
    fireEvent.press(getByTestId("face-accept-10"));

    await waitFor(() => expect(body).toEqual({ face_ids: [10], person_name: "Alice" }));
  });

  it("assigns a new name to selected unknown faces", async () => {
    let body: unknown;
    const { getByTestId } = renderWithDb(<FaceTaggingScreen />, t.db, client((b) => (body = b)));

    fireEvent.press(getByTestId("faces-tab-unknown"));
    await waitFor(() => expect(getByTestId("face-20")).toBeTruthy());

    fireEvent.press(getByTestId("face-20"));
    await waitFor(() => expect(getByTestId("faces-assign")).toBeTruthy());
    fireEvent.press(getByTestId("faces-assign"));

    fireEvent.changeText(getByTestId("assign-name-input"), "Bob");
    fireEvent.press(getByTestId("assign-name-create"));

    await waitFor(() => expect(body).toEqual({ face_ids: [20], person_name: "Bob" }));
  });

  it("shows an offline state when disconnected", async () => {
    (globalThis as { __mockNetworkConnected?: boolean }).__mockNetworkConnected = false;
    const { getByTestId } = renderWithDb(<FaceTaggingScreen />, t.db, client());
    await waitFor(() => expect(getByTestId("faces-offline")).toBeTruthy());
  });
});
