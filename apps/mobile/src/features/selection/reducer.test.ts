import {
  emptySelection,
  selectionReducer,
  selectionCount,
  isSelected,
  selectedImageHashes,
  selectedPhotoIds,
  selectedDownloadableHashes,
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

describe("selectedDownloadableHashes", () => {
  it("keeps server photos that are not on the phone, once per hash", () => {
    let s = selectionReducer(emptySelection, { type: "enter", item: { key: "a", photoId: "a-id", imageHash: "h1" } });
    // The same hash under a second photo id (a duplicate) is saved once.
    s = selectionReducer(s, { type: "toggle", item: { key: "a2", photoId: "a2-id", imageHash: "h1", localUri: null } });
    // On the phone already, server copy or not.
    s = selectionReducer(s, { type: "toggle", item: { key: "b", photoId: "b-id", imageHash: "h2", localUri: "ph://b" } });
    // Only on the phone: nothing on the server to fetch.
    s = selectionReducer(s, { type: "toggle", item: { key: "c", photoId: null, imageHash: "h3", localUri: "ph://c" } });
    // Not hashed yet.
    s = selectionReducer(s, { type: "toggle", item: { key: "d", photoId: "d-id", imageHash: null } });
    expect(selectedDownloadableHashes(s)).toEqual(["h1"]);
  });
});
