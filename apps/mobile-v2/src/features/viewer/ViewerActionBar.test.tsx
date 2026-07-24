import { fireEvent } from "@testing-library/react-native";
import { ViewerActionBar } from "./ViewerActionBar";
import { renderWithProviders, makeMockClient, jsonResponse } from "@/test/test-utils";

function setup(overrides: Partial<React.ComponentProps<typeof ViewerActionBar>> = {}) {
  const handlers = {
    onToggleFavorite: jest.fn(),
    onToggleHide: jest.fn(),
    onToggleTrash: jest.fn(),
    onRate: jest.fn(),
    onEditCaption: jest.fn(),
    onAddToAlbum: jest.fn(),
  };
  const client = makeMockClient(async () => jsonResponse({}, 404));
  const utils = renderWithProviders(
    <ViewerActionBar isFavorite={false} hidden={false} inTrashcan={false} rating={0} {...handlers} {...overrides} />,
    client
  );
  return { ...utils, handlers };
}

describe("ViewerActionBar", () => {
  it("dispatches favorite/hide/trash/caption/add-to-album", () => {
    const { getByTestId, handlers } = setup();
    fireEvent.press(getByTestId("viewer-favorite"));
    fireEvent.press(getByTestId("viewer-hide"));
    fireEvent.press(getByTestId("viewer-trash"));
    fireEvent.press(getByTestId("viewer-caption"));
    fireEvent.press(getByTestId("viewer-add-album"));
    expect(handlers.onToggleFavorite).toHaveBeenCalled();
    expect(handlers.onToggleHide).toHaveBeenCalled();
    expect(handlers.onToggleTrash).toHaveBeenCalled();
    expect(handlers.onEditCaption).toHaveBeenCalled();
    expect(handlers.onAddToAlbum).toHaveBeenCalled();
  });

  it("rates by tapping a star, and clears when tapping the current rating", () => {
    const { getByTestId, handlers } = setup({ rating: 0 });
    fireEvent.press(getByTestId("viewer-star-4"));
    expect(handlers.onRate).toHaveBeenCalledWith(4);

    const atFour = setup({ rating: 4 });
    fireEvent.press(atFour.getByTestId("viewer-star-4"));
    // Tapping the current rating clears it to 0.
    expect(atFour.handlers.onRate).toHaveBeenCalledWith(0);
  });

  it("shows Restore instead of Trash when the photo is trashed", () => {
    const { getByText } = setup({ inTrashcan: true });
    expect(getByText("Restore")).toBeTruthy();
  });
});
