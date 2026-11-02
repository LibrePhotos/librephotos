import { fireEvent } from "@testing-library/react-native";
import { ViewerActionBar, type ViewerActionBarProps } from "./ViewerActionBar";
import { renderWithProviders, makeMockClient, jsonResponse } from "@/test/test-utils";

type RemoteProps = Extract<ViewerActionBarProps, { mode: "remote" }>;

function setup(overrides: Partial<Omit<RemoteProps, "mode">> = {}) {
  const handlers = {
    onShare: jest.fn<void, []>(),
    onToggleFavorite: jest.fn<void, []>(),
    onEdit: jest.fn<void, []>(),
    onToggleTrash: jest.fn<void, []>(),
    onMore: jest.fn<void, []>(),
  };
  const client = makeMockClient(async () => jsonResponse({}, 404));
  const utils = renderWithProviders(
    <ViewerActionBar
      mode="remote"
      isFavorite={false}
      inTrashcan={false}
      hasLocalCopy={false}
      isOnline
      bottomInset={0}
      {...handlers}
      {...overrides}
    />,
    client
  );
  return { ...utils, handlers };
}

describe("ViewerActionBar", () => {
  /** Google Photos' shape: five labelled actions, the rest behind "More". */
  it("dispatches share, favorite, edit, trash and more", () => {
    const { getByTestId, handlers } = setup();
    fireEvent.press(getByTestId("viewer-share"));
    fireEvent.press(getByTestId("viewer-favorite"));
    fireEvent.press(getByTestId("viewer-edit"));
    fireEvent.press(getByTestId("viewer-trash"));
    fireEvent.press(getByTestId("viewer-more"));
    expect(handlers.onShare).toHaveBeenCalled();
    expect(handlers.onToggleFavorite).toHaveBeenCalled();
    expect(handlers.onEdit).toHaveBeenCalled();
    expect(handlers.onToggleTrash).toHaveBeenCalled();
    expect(handlers.onMore).toHaveBeenCalled();
  });

  it("shows Restore instead of Trash when the photo is trashed", () => {
    const { getByText } = setup({ inTrashcan: true });
    expect(getByText("Restore")).toBeTruthy();
  });

  /**
   * Sharing a server-only item fetches its original, so offline it must SAY it
   * needs a connection rather than sit there looking tappable (doc 07 §4).
   */
  it("disables share offline for a server-only item and explains why", () => {
    const { getByTestId, getByText, handlers } = setup({ isOnline: false });
    fireEvent.press(getByTestId("viewer-share"));
    expect(handlers.onShare).not.toHaveBeenCalled();
    expect(getByText("Needs a connection")).toBeTruthy();
  });

  it("shares a phone copy offline", () => {
    const { getByTestId, handlers } = setup({ isOnline: false, hasLocalCopy: true });
    fireEvent.press(getByTestId("viewer-share"));
    expect(handlers.onShare).toHaveBeenCalled();
  });

  it("keeps the offline-capable actions working offline", () => {
    const { getByTestId, handlers } = setup({ isOnline: false });
    fireEvent.press(getByTestId("viewer-favorite"));
    fireEvent.press(getByTestId("viewer-trash"));
    fireEvent.press(getByTestId("viewer-more"));
    expect(handlers.onToggleFavorite).toHaveBeenCalled();
    expect(handlers.onToggleTrash).toHaveBeenCalled();
    expect(handlers.onMore).toHaveBeenCalled();
  });

  /** A camera-roll-only item has no server row: Share is the one thing to do with it. */
  it("offers only Share for a camera-roll-only item", () => {
    const onShare = jest.fn<void, []>();
    const client = makeMockClient(async () => jsonResponse({}, 404));
    const { getByTestId, queryByTestId } = renderWithProviders(
      <ViewerActionBar mode="local" isOnline={false} bottomInset={0} onShare={onShare} />,
      client
    );
    fireEvent.press(getByTestId("viewer-share"));
    expect(onShare).toHaveBeenCalled();
    expect(queryByTestId("viewer-favorite")).toBeNull();
    expect(queryByTestId("viewer-more")).toBeNull();
  });
});
