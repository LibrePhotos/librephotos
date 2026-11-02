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
  /** Open the "More" sheet, where the less common actions live. */
  const openMore = () => fireEvent.press(utils.getByTestId("action-more"));
  return { ...utils, handlers, openMore };
}

describe("SelectionActionBar", () => {
  it("shows the selected count and dispatches offline actions", () => {
    const { getByTestId, handlers, openMore } = setup();
    expect(getByTestId("selection-count")).toBeTruthy();
    fireEvent.press(getByTestId("action-favorite"));
    fireEvent.press(getByTestId("action-trash"));
    fireEvent.press(getByTestId("action-add-album"));
    openMore();
    fireEvent.press(getByTestId("action-hide"));
    expect(handlers.onFavorite).toHaveBeenCalled();
    expect(handlers.onHide).toHaveBeenCalled();
    expect(handlers.onTrash).toHaveBeenCalled();
    expect(handlers.onAddToAlbum).toHaveBeenCalled();
  });

  it("keeps the everyday actions in the bar and the rest behind More", () => {
    const { queryByTestId, getByTestId, openMore } = setup({ onShareLink: jest.fn(), onDownload: jest.fn() });
    expect(getByTestId("action-favorite")).toBeTruthy();
    expect(getByTestId("action-add-album")).toBeTruthy();
    expect(getByTestId("action-share-link")).toHaveTextContent("Share");
    expect(getByTestId("action-trash")).toBeTruthy();
    expect(queryByTestId("action-hide")).toBeNull();
    expect(queryByTestId("action-download")).toBeNull();
    openMore();
    expect(getByTestId("action-hide")).toBeTruthy();
    expect(getByTestId("action-download")).toBeTruthy();
  });

  it("names the flag buttons by the way they go", () => {
    const { getByTestId: setting } = setup();
    expect(setting("action-trash")).toHaveTextContent("Trash");
    const inTrash = setup({
      directions: { favorite: false, hidden: false, deleted: false, archived: false },
      onArchive: jest.fn(),
    });
    expect(inTrash.getByTestId("action-favorite")).toHaveTextContent("Unfavorite");
    expect(inTrash.getByTestId("action-trash")).toHaveTextContent("Restore");
    inTrash.openMore();
    expect(inTrash.getByTestId("action-hide")).toHaveTextContent("Unhide");
    expect(inTrash.getByTestId("action-archive")).toHaveTextContent("Unarchive");
  });

  it("archives from the More sheet, offline too", () => {
    const onArchive = jest.fn<void, []>();
    const { getByTestId, openMore } = setup({ isOnline: false, onArchive });
    openMore();
    expect(getByTestId("action-archive")).toHaveTextContent("Archive");
    fireEvent.press(getByTestId("action-archive"));
    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it("rates the selection with stars, or clears the rating", () => {
    const onRate = jest.fn<void, [number]>();
    const { getByTestId, openMore } = setup({ onRate });
    openMore();
    fireEvent.press(getByTestId("action-rate-4"));
    openMore();
    fireEvent.press(getByTestId("action-rate-0"));
    expect(onRate.mock.calls).toEqual([[4], [0]]);
  });

  it("offers Set as cover only for a single photo", () => {
    const onSetCover = jest.fn<void, []>();
    const two = setup({ onSetCover });
    two.openMore();
    expect(two.queryByTestId("action-set-cover")).toBeNull();

    const one = setup({ count: 1, onSetCover });
    one.openMore();
    fireEvent.press(one.getByTestId("action-set-cover"));
    expect(onSetCover).toHaveBeenCalledTimes(1);
  });

  it("disables online-only actions when offline", () => {
    const onDownload = jest.fn<void, []>();
    const { getByTestId, openMore, getAllByText } = setup({ isOnline: false, onDownload });
    openMore();
    fireEvent.press(getByTestId("action-download"));
    // Offline: the online-only handler must NOT fire, and the row says why.
    expect(onDownload).not.toHaveBeenCalled();
    expect(getByTestId("action-download").props.accessibilityState).toHaveProperty("disabled", true);
    expect(getAllByText("Needs a connection").length).toBeGreaterThan(0);
  });

  it("enables online-only actions when online", () => {
    const onDownload = jest.fn<void, []>();
    const { getByTestId, openMore } = setup({ isOnline: true, onDownload });
    openMore();
    fireEvent.press(getByTestId("action-download"));
    expect(onDownload).toHaveBeenCalled();
  });

  it("leaves out an online-only action that has no handler, instead of drawing a dead button", () => {
    const { queryByTestId, openMore } = setup();
    expect(queryByTestId("action-share-link")).toBeNull();
    openMore();
    expect(queryByTestId("action-download")).toBeNull();
    expect(queryByTestId("action-delete-permanent")).toBeNull();
    expect(queryByTestId("action-archive")).toBeNull();
    expect(queryByTestId("action-rate-1")).toBeNull();
  });

  it("offers delete-permanent when given, disabled while offline", () => {
    const onDeletePermanent = jest.fn<void, []>();
    const online = setup({ onDeletePermanent });
    online.openMore();
    expect(online.getByText("Delete permanently")).toBeTruthy();
    fireEvent.press(online.getByTestId("action-delete-permanent"));
    expect(onDeletePermanent).toHaveBeenCalledTimes(1);

    const offline = setup({ isOnline: false, onDeletePermanent });
    offline.openMore();
    fireEvent.press(offline.getByTestId("action-delete-permanent"));
    expect(onDeletePermanent).toHaveBeenCalledTimes(1);
    expect(offline.getByTestId("action-delete-permanent").props.accessibilityState).toHaveProperty("disabled", true);
  });

  it("renders a remove-from-album action only when provided", () => {
    const onRemoveFromAlbum = jest.fn<void, []>();
    const { queryByTestId } = setup();
    expect(queryByTestId("action-remove-album")).toBeNull();
    const withRemove = setup({ onRemoveFromAlbum });
    fireEvent.press(withRemove.getByTestId("action-remove-album"));
    expect(onRemoveFromAlbum).toHaveBeenCalled();
  });
});
