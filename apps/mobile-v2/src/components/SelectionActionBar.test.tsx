import { fireEvent } from "@testing-library/react-native";
import { SelectionActionBar } from "./SelectionActionBar";
import { renderWithProviders, makeMockClient, jsonResponse } from "@/test/test-utils";

function setup(overrides: Partial<React.ComponentProps<typeof SelectionActionBar>> = {}) {
  const handlers = {
    onFavorite: jest.fn(),
    onHide: jest.fn(),
    onTrash: jest.fn(),
    onAddToAlbum: jest.fn(),
    onCancel: jest.fn(),
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

  it("disables online-only actions when offline", () => {
    const onDownload = jest.fn();
    const { getByTestId } = setup({ isOnline: false, onDownload });
    fireEvent.press(getByTestId("action-download"));
    // Offline: the online-only handler must NOT fire.
    expect(onDownload).not.toHaveBeenCalled();
    expect(getByTestId("action-download").props.accessibilityState.disabled).toBe(true);
  });

  it("enables online-only actions when online", () => {
    const onDownload = jest.fn();
    const { getByTestId } = setup({ isOnline: true, onDownload });
    fireEvent.press(getByTestId("action-download"));
    expect(onDownload).toHaveBeenCalled();
  });

  it("renders a remove-from-album action only when provided", () => {
    const onRemoveFromAlbum = jest.fn();
    const { getByTestId, queryByTestId, handlers } = setup();
    expect(queryByTestId("action-remove-album")).toBeNull();
    const withRemove = setup({ onRemoveFromAlbum });
    void handlers;
    fireEvent.press(withRemove.getByTestId("action-remove-album"));
    expect(onRemoveFromAlbum).toHaveBeenCalled();
    void getByTestId;
  });
});
