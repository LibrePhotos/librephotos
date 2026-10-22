import { PhotoTile, tileBadge, type GridItem } from "./PhotoTile";
import { renderWithDb } from "@/test/test-utils";
import { createTestDb, type TestDb } from "@/db/test-db";

function item(over: Partial<GridItem>): GridItem {
  return {
    key: "k1",
    photoId: null,
    imageHash: "h1",
    type: "image",
    dominantColor: null,
    localUri: "ph://k1",
    ...over,
  };
}

describe("tileBadge", () => {
  it("shows the hourglass while the server processes an uploaded photo (#2740)", () => {
    expect(tileBadge({ photoId: null, processing: true })).toBe("processing");
  });

  it("shows the upload arrow for a photo only on this phone", () => {
    expect(tileBadge({ photoId: null, processing: false })).toBe("local");
    expect(tileBadge({ photoId: null })).toBe("local");
  });

  it("shows nothing on a server photo", () => {
    expect(tileBadge({ photoId: "p1", processing: true })).toBeNull();
  });
});

describe("PhotoTile badges", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  function render(over: Partial<GridItem>) {
    return renderWithDb(<PhotoTile item={item(over)} size={100} serverAddress="https://lp.test" headers={{}} />, t.db);
  }

  it("swaps the arrow for a labelled hourglass while the server processes", () => {
    const { getByTestId, queryByTestId } = render({ processing: true });
    expect(getByTestId("processing-badge-k1").props.accessibilityLabel).toBe(
      "Uploaded, the server is still processing it"
    );
    expect(queryByTestId("local-badge-k1")).toBeNull();
  });

  it("keeps the arrow on a photo that is only on this phone", () => {
    const { getByTestId, queryByTestId } = render({});
    expect(getByTestId("local-badge-k1")).toBeTruthy();
    expect(queryByTestId("processing-badge-k1")).toBeNull();
  });
});
