import type { BulkPhotoQuery, PigPhoto } from "@librephotos/api-client";
import type { PhotoSelection } from "../../api_client/photos/photoSelection";

/** What a dialog or an action needs of a selected photo. */
export type PhotoRef = Pick<PigPhoto, "id" | "image_hash" | "type">;

/**
 * The selection of a photo list, one state at a time:
 * - `off`: not selecting;
 * - `some`: the photos picked one by one. `keepOpen` when the Select button or the selection bar
 *   started it, so select mode stays open with nothing picked; a selection started by ticking a
 *   tile ends with its last tile;
 * - `all`: every photo of the list's server-side `query` except the `excluded` ones. There is no
 *   select all without a query: an empty query would match the whole library.
 *
 * Placeholder tiles (`isTemp`) never enter it: they have no photo behind them yet.
 */
export type ListSelection =
  | Readonly<{ kind: "off" }>
  | Readonly<{ kind: "some"; items: readonly PigPhoto[]; keepOpen: boolean }>
  | Readonly<{ kind: "all"; query: BulkPhotoQuery; excluded: readonly PigPhoto[] }>;

export type SelectionEvent =
  /** The Select button: select mode with nothing picked yet. */
  | Readonly<{ type: "enter" }>
  /** ✕, Escape, an action that finished, or a filter that changed what the list shows. */
  | Readonly<{ type: "clear" }>
  /** A tile clicked: picked or unpicked, or after select all, left out or taken back in. */
  | Readonly<{ type: "toggle"; item: PigPhoto }>
  /** Shift-click: the range joins the selection (or, after select all, the exclusions). */
  | Readonly<{ type: "addRange"; items: readonly PigPhoto[] }>
  /** Select all on a list without a server-side query: the loaded photos. */
  | Readonly<{ type: "selectLoaded"; items: readonly PigPhoto[] }>
  | Readonly<{ type: "selectAll"; query: BulkPhotoQuery }>
  /** Deselect in the selection bar: select mode stays open. */
  | Readonly<{ type: "deselectAll" }>;

export const SELECTION_OFF: ListSelection = { kind: "off" };

const NO_PHOTOS: readonly PigPhoto[] = [];

const realPhotos = (items: readonly PigPhoto[]) => items.filter(item => !item.isTemp);

const toggled = (items: readonly PigPhoto[], item: PigPhoto) =>
  items.some(other => other.id === item.id) ? items.filter(other => other.id !== item.id) : [...items, item];

const withRange = (items: readonly PigPhoto[], range: readonly PigPhoto[]) => [
  ...items,
  ...realPhotos(range).filter(item => !items.some(other => other.id === item.id)),
];

function toggle(selection: ListSelection, item: PigPhoto): ListSelection {
  if (item.isTemp) return selection;
  switch (selection.kind) {
    case "off":
      return { kind: "some", items: [item], keepOpen: false };
    case "some": {
      const items = toggled(selection.items, item);
      return items.length === 0 && !selection.keepOpen ? SELECTION_OFF : { ...selection, items };
    }
    case "all":
      return { ...selection, excluded: toggled(selection.excluded, item) };
  }
}

function addRange(selection: ListSelection, range: readonly PigPhoto[]): ListSelection {
  switch (selection.kind) {
    case "off": {
      const items = realPhotos(range);
      return items.length === 0 ? selection : { kind: "some", items, keepOpen: false };
    }
    case "some":
      return { ...selection, items: withRange(selection.items, range) };
    case "all":
      return { ...selection, excluded: withRange(selection.excluded, range) };
  }
}

/** The one place a photo list's selection changes. */
export function nextSelection(selection: ListSelection, event: SelectionEvent): ListSelection {
  switch (event.type) {
    case "enter":
      return selection.kind === "off" ? { kind: "some", items: NO_PHOTOS, keepOpen: true } : selection;
    case "clear":
      return SELECTION_OFF;
    case "toggle":
      return toggle(selection, event.item);
    case "addRange":
      return addRange(selection, event.items);
    case "selectLoaded":
      return { kind: "some", items: realPhotos(event.items), keepOpen: true };
    case "selectAll":
      return { kind: "all", query: event.query, excluded: NO_PHOTOS };
    case "deselectAll":
      return { kind: "some", items: NO_PHOTOS, keepOpen: true };
  }
}

/** Select mode is on: the selection bar shows and a click on a tile picks it. */
export const isSelecting = (selection: ListSelection) => selection.kind !== "off";

/** Where a shift-click range starts: the photo picked (or, after select all, left out) last. */
export function rangeAnchor(selection: ListSelection): PigPhoto | undefined {
  if (selection.kind === "some") return selection.items.at(-1);
  if (selection.kind === "all") return selection.excluded.at(-1);
  return undefined;
}

/** The tiles that show as selected: after select all, every loaded photo but the excluded ones. */
export function selectedTiles(selection: ListSelection, idx2hash: readonly PigPhoto[]): readonly PigPhoto[] {
  if (selection.kind === "some") return selection.items;
  if (selection.kind === "off") return NO_PHOTOS;
  const excluded = new Set(selection.excluded.map(item => item.id));
  return idx2hash.filter(item => !item.isTemp && !excluded.has(item.id));
}

/**
 * What the selection bar's actions and the dialogs act on: the photos picked, or every photo of
 * `query` but the `excluded` ones, `total` of them before those are taken out.
 */
export type Selected<P extends PhotoRef = PigPhoto> =
  | Readonly<{ kind: "some"; items: readonly P[] }>
  | Readonly<{ kind: "all"; query: BulkPhotoQuery; excluded: readonly P[]; total: number }>;

/** The selection as its actions read it; `total` is the list's live count. */
export function selectedOf(selection: ListSelection, total: number): Selected {
  if (selection.kind === "all") return { kind: "all", query: selection.query, excluded: selection.excluded, total };
  return { kind: "some", items: selection.kind === "some" ? selection.items : NO_PHOTOS };
}

/** The photos picked one by one; none after select all, whose photos are not all loaded. */
export const pickedPhotos = <P extends PhotoRef>(selected: Selected<P>): readonly P[] =>
  selected.kind === "some" ? selected.items : [];

/** How many photos the selection holds. After select all, the total less the excluded ones. */
export const selectedCount = (selected: Selected<PhotoRef>) =>
  selected.kind === "all" ? Math.max(0, selected.total - selected.excluded.length) : selected.items.length;

/** Whether there is anything to act on. */
export const hasSelection = (selected: Selected<PhotoRef>) => selected.kind === "all" || selected.items.length > 0;

/** The select-all part of a bulk request, for the endpoints that take it apart from the photos. */
export const selectAllOf = (
  selected: Selected<PhotoRef>
): Readonly<{ query: BulkPhotoQuery; excludedHashes: string[] }> | undefined =>
  selected.kind === "all"
    ? { query: selected.query, excludedHashes: selected.excluded.map(item => item.image_hash) }
    : undefined;

/** The selection as a bulk photo mutation takes it. */
export function toPhotoSelection(selected: Selected<PhotoRef>): PhotoSelection {
  if (selected.kind === "all") {
    return {
      select_all: true,
      query: selected.query,
      excluded_hashes: selected.excluded.map(item => item.image_hash),
    };
  }
  return { image_hashes: selected.items.map(item => item.image_hash) };
}
