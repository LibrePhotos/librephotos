import { fireEvent } from "@testing-library/react-native";
import { SelectionActionBar } from "./SelectionActionBar";
import { renderWithProviders, makeMockClient, jsonResponse } from "@/test/test-utils";

function setup(overrides: Partial<React.ComponentProps<typeof SelectionActionBar>> = {}) {
  const handlers = {
    onFavorite: jest.fn<void, []>(),
    onHide: jest.fn<void, []>(),
    onTrash: jest.fn<void, []>(),
    onAddToAlbum: jest.fn<void, []>(),
    onCancel: jest.fn<void, []>(),
  };
  const client = makeMockClient(async () => jsonResponse({}, 404));
  const utils = renderWithProviders(
    <SelectionActionBar count={2} isOnline={true} {...handlers} {...overrides} />,
    client
  );
  return { ...utils, handlers };
}

describe("SelectionActionBar", () => {
  it("shows the selected count and dispatches offline actions", () => {
    const { getByTestId, handlers } = setup();
    expect(getByTestId("selection-count")).toBeTruthy();
    fireEvent.press(getByTestId("action-favorite"));
    fireEvent.press(getByTestId("action-hide"));
    fireEvent.press(getByTestId("action-trash"));
    fireEvent.press(getByTestId("action-add-album"));
    expect(handlers.onFavorite).toHaveBeenCalled();
    expect(handlers.onHide).toHaveBeenCalled();
    expect(handlers.onTrash).toHaveBeenCalled();
    expect(handlers.onAddToAlbum).toHaveBeenCalled();
  });

  it("names the flag buttons by the way they go", () => {
    const { getByTestId: setting } = setup();
    expect(setting("action-trash")).toHaveTextContent("Trash");
    const { getByTestId: inTrash } = setup({ directions: { favorite: false, hidden: false, deleted: false } });
    expect(inTrash("action-favorite")).toHaveTextContent("Unfavorite");
    expect(inTrash("action-hide")).toHaveTextContent("Unhide");
    expect(inTrash("action-trash")).toHaveTextContent("Restore");
  });

  it("disables online-only actions when offline", () => {
    const onDownload = jest.fn<void, []>();
    const { getByTestId } = setup({ isOnline: false, onDownload });
    fireEvent.press(getByTestId("action-download"));
    // Offline: the online-only handler must NOT fire.
    expect(onDownload).not.toHaveBeenCalled();
    expect(getByTestId("action-download").props.accessibilityState).toHaveProperty("disabled", true);
  });

  it("enables online-only actions when online", () => {
    const onDownload = jest.fn<void, []>();
    const { getByTestId } = setup({ isOnline: true, onDownload });
    fireEvent.press(getByTestId("action-download"));
    expect(onDownload).toHaveBeenCalled();
  });

  it("leaves out an online-only action that has no handler, instead of drawing a dead button", () => {
    const { queryByTestId } = setup();
    expect(queryByTestId("action-download")).toBeNull();
    expect(queryByTestId("action-share-link")).toBeNull();
    expect(queryByTestId("action-delete-permanent")).toBeNull();
  });

  it("offers delete-permanent when given, disabled while offline", () => {
    const onDeletePermanent = jest.fn<void, []>();
    const online = setup({ onDeletePermanent });
    expect(online.getByText("Delete permanently")).toBeTruthy();
    fireEvent.press(online.getByTestId("action-delete-permanent"));
    expect(onDeletePermanent).toHaveBeenCalledTimes(1);

    const offline = setup({ isOnline: false, onDeletePermanent });
    fireEvent.press(offline.getByTestId("action-delete-permanent"));
    expect(onDeletePermanent).toHaveBeenCalledTimes(1);
    expect(offline.getByTestId("action-delete-permanent").props.accessibilityState).toHaveProperty("disabled", true);
  });

  it("renders a remove-from-album action only when provided", () => {
    const onRemoveFromAlbum = jest.fn<void, []>();
    const { getByTestId, queryByTestId, handlers } = setup();
    expect(queryByTestId("action-remove-album")).toBeNull();
    const withRemove = setup({ onRemoveFromAlbum });
    void handlers;
    fireEvent.press(withRemove.getByTestId("action-remove-album"));
    expect(onRemoveFromAlbum).toHaveBeenCalled();
    void getByTestId;
  });
});
