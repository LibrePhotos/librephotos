import { fireEvent } from "@testing-library/react-native";
import { ViewerEditSheet, ViewerMoreSheet, type ViewerEditSheetProps, type ViewerMoreSheetProps } from "./ViewerSheets";
import { renderWithProviders, makeMockClient, jsonResponse } from "@/test/test-utils";

const client = () => makeMockClient(async () => jsonResponse({}, 404));

function more(overrides: Partial<ViewerMoreSheetProps> = {}) {
  const props: ViewerMoreSheetProps = {
    visible: true,
    onClose: jest.fn<void, []>(),
    isOnline: true,
    rating: 0,
    hidden: false,
    archived: false,
    isPublic: false,
    inTrashcan: false,
    canSaveToDevice: true,
    onRate: jest.fn<void, [rating: number]>(),
    onSaveToDevice: jest.fn<void, []>(),
    onAddToAlbum: jest.fn<void, []>(),
    onToggleArchive: jest.fn<void, []>(),
    onToggleHide: jest.fn<void, []>(),
    onTogglePublic: jest.fn<void, []>(),
    onDeletePermanently: jest.fn<void, []>(),
    ...overrides,
  };
  return { ...renderWithProviders(<ViewerMoreSheet {...props} />, client()), props };
}

function edit(overrides: Partial<ViewerEditSheetProps> = {}) {
  const props: ViewerEditSheetProps = {
    visible: true,
    onClose: jest.fn<void, []>(),
    isOnline: true,
    canRotate: true,
    onRotateLeft: jest.fn<void, []>(),
    onRotateRight: jest.fn<void, []>(),
    onEditDate: jest.fn<void, []>(),
    onEditLocation: jest.fn<void, []>(),
    onEditTags: jest.fn<void, []>(),
    ...overrides,
  };
  return { ...renderWithProviders(<ViewerEditSheet {...props} />, client()), props };
}

describe("ViewerMoreSheet", () => {
  it("rates by tapping a star, and clears when tapping the current rating", () => {
    const { getByTestId, props } = more({ rating: 0 });
    fireEvent.press(getByTestId("viewer-star-4"));
    expect(props.onRate).toHaveBeenCalledWith(4);

    const atFour = more({ rating: 4 });
    fireEvent.press(atFour.getByTestId("viewer-star-4"));
    expect(atFour.props.onRate).toHaveBeenCalledWith(0);
  });

  it("closes, then runs the row that was tapped", () => {
    const { getByTestId, props } = more();
    fireEvent.press(getByTestId("viewer-menu-archive"));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onToggleArchive).toHaveBeenCalled();
  });

  it("names the opposite of the current state", () => {
    const { getByText } = more({ archived: true, hidden: true, isPublic: true });
    expect(getByText("Unarchive")).toBeTruthy();
    expect(getByText("Unhide")).toBeTruthy();
    expect(getByText("Make private")).toBeTruthy();
  });

  /** Deleting for good is the web Trash's action: only a trashed item offers it. */
  it("offers delete permanently only for a trashed item", () => {
    expect(more().queryByTestId("viewer-menu-delete-permanent")).toBeNull();
    const trashed = more({ inTrashcan: true });
    fireEvent.press(trashed.getByTestId("viewer-menu-delete-permanent"));
    expect(trashed.props.onDeletePermanently).toHaveBeenCalled();
  });

  it("offers save to device only for a server-only item", () => {
    expect(more({ canSaveToDevice: false }).queryByTestId("viewer-menu-save")).toBeNull();
    const { getByTestId, props } = more();
    fireEvent.press(getByTestId("viewer-menu-save"));
    expect(props.onSaveToDevice).toHaveBeenCalled();
  });

  /**
   * Archive, hide and add-to-album ride the outbox; save, make-public and
   * delete-permanently talk to the server and must say so when offline.
   */
  it("keeps outbox rows working offline and disables the online-only ones", () => {
    const { getByTestId, getAllByText, props } = more({ isOnline: false, inTrashcan: true });
    for (const key of ["archive", "hide", "album"]) {
      expect(getByTestId(`viewer-menu-${key}`).props.accessibilityState).toHaveProperty("disabled", false);
    }
    for (const key of ["save", "public", "delete-permanent"]) {
      const row = getByTestId(`viewer-menu-${key}`);
      expect(row.props.accessibilityState).toHaveProperty("disabled", true);
      fireEvent.press(row);
    }
    expect(props.onSaveToDevice).not.toHaveBeenCalled();
    expect(props.onTogglePublic).not.toHaveBeenCalled();
    expect(props.onDeletePermanently).not.toHaveBeenCalled();
    expect(getAllByText("Needs a connection")).toHaveLength(3);
  });

  it("renders nothing while closed", () => {
    expect(more({ visible: false }).queryByTestId("viewer-more-sheet")).toBeNull();
  });
});

describe("ViewerEditSheet", () => {
  it("routes each row to its editor", () => {
    const { getByTestId, props } = edit();
    fireEvent.press(getByTestId("viewer-menu-rotate-left"));
    fireEvent.press(getByTestId("viewer-menu-rotate-right"));
    fireEvent.press(getByTestId("viewer-menu-date"));
    fireEvent.press(getByTestId("viewer-menu-location"));
    fireEvent.press(getByTestId("viewer-menu-tags"));
    expect(props.onRotateLeft).toHaveBeenCalled();
    expect(props.onRotateRight).toHaveBeenCalled();
    expect(props.onEditDate).toHaveBeenCalled();
    expect(props.onEditLocation).toHaveBeenCalled();
    expect(props.onEditTags).toHaveBeenCalled();
  });

  it("does not offer rotation for a video", () => {
    expect(edit({ canRotate: false }).queryByTestId("viewer-menu-rotate-left")).toBeNull();
  });

  it("disables every server-side edit offline", () => {
    const { getByTestId, props } = edit({ isOnline: false });
    for (const key of ["rotate-left", "rotate-right", "date", "location", "tags"]) {
      const row = getByTestId(`viewer-menu-${key}`);
      expect(row.props.accessibilityState).toHaveProperty("disabled", true);
      fireEvent.press(row);
    }
    expect(props.onRotateLeft).not.toHaveBeenCalled();
    expect(props.onEditDate).not.toHaveBeenCalled();
    expect(props.onEditTags).not.toHaveBeenCalled();
  });
});
