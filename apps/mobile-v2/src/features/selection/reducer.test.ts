import {
  emptySelection,
  selectionReducer,
  selectionCount,
  isSelected,
  selectedImageHashes,
  selectedPhotoIds,
  type SelectableItem,
} from "./reducer";

const item = (key: string, photoId = `${key}-id`, imageHash = `${key}-h`): SelectableItem => ({
  key,
  photoId,
  imageHash,
});

describe("selectionReducer", () => {
  it("enter activates with one item", () => {
    const s = selectionReducer(emptySelection, { type: "enter", item: item("a") });
    expect(s.active).toBe(true);
    expect(selectionCount(s)).toBe(1);
    expect(isSelected(s, "a")).toBe(true);
  });

  it("toggle adds then removes; empties auto-exit", () => {
    let s = selectionReducer(emptySelection, { type: "enter", item: item("a") });
    s = selectionReducer(s, { type: "toggle", item: item("b") });
    expect(selectionCount(s)).toBe(2);
    s = selectionReducer(s, { type: "toggle", item: item("b") });
    expect(selectionCount(s)).toBe(1);
    s = selectionReducer(s, { type: "toggle", item: item("a") });
    // Nothing selected → selection mode exits.
    expect(s.active).toBe(false);
    expect(selectionCount(s)).toBe(0);
  });

  it("toggleGroup selects a whole group, then clears it when all selected", () => {
    const group = [item("a"), item("b"), item("c")];
    let s = selectionReducer(emptySelection, { type: "toggleGroup", items: group });
    expect(selectionCount(s)).toBe(3);
    // All selected → toggling again clears them.
    s = selectionReducer(s, { type: "toggleGroup", items: group });
    expect(s.active).toBe(false);
  });

  it("toggleGroup selects missing members when partially selected", () => {
    let s = selectionReducer(emptySelection, { type: "enter", item: item("a") });
    s = selectionReducer(s, { type: "toggleGroup", items: [item("a"), item("b")] });
    expect(selectionCount(s)).toBe(2);
  });

  it("clear resets to empty", () => {
    let s = selectionReducer(emptySelection, { type: "enter", item: item("a") });
    s = selectionReducer(s, { type: "clear" });
    expect(s).toEqual(emptySelection);
  });

  it("selectors return distinct hashes + ids, skipping nulls", () => {
    let s = selectionReducer(emptySelection, { type: "enter", item: item("a", "pa", "ha") });
    s = selectionReducer(s, { type: "toggle", item: { key: "b", photoId: null, imageHash: null } });
    expect(selectedImageHashes(s)).toEqual(["ha"]);
    expect(selectedPhotoIds(s)).toEqual(["pa"]);
  });
});
