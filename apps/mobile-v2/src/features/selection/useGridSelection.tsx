import { useCallback, useReducer, useState, type ReactElement } from "react";
import { useMutations } from "@/mutations/useMutations";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { SelectionActionBar } from "@/components/SelectionActionBar";
import { AlbumPickerSheet } from "@/components/AlbumPickerSheet";
import { ShareSheet } from "@/features/sharing/ShareSheet";
import {
  emptySelection,
  isSelected as isSelectedSel,
  selectedImageHashes,
  selectedItems,
  selectedPhotoIds,
  selectionCount,
  selectionReducer,
  type SelectableItem,
} from "./reducer";

/** Which boolean each flag action applies (a filter screen inverts its own). */
export type SelectionDirections = {
  favorite?: boolean;
  hidden?: boolean;
  deleted?: boolean;
};

/**
 * Wires grid multi-select to the offline-mutation outbox. Owns the selection
 * reducer + the action bar + the add-to-album sheet, and returns the item
 * handlers a grid needs. Bulk actions dispatch through `useMutations` (optimistic
 * mirror write → outbox → replay) and then exit selection mode.
 */
export function useGridSelection(
  directions: SelectionDirections = {},
  /** When set, the action bar gains a "Remove from this album" action. */
  album?: { albumId: number; title: string }
) {
  const mutations = useMutations();
  const isOnline = useOnlineStatus();
  const [state, dispatch] = useReducer(selectionReducer, emptySelection);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareHashes, setShareHashes] = useState<string[]>([]);

  const dir = {
    favorite: directions.favorite ?? true,
    hidden: directions.hidden ?? true,
    deleted: directions.deleted ?? true,
  };

  const enter = useCallback((item: SelectableItem) => dispatch({ type: "enter", item }), []);
  const toggle = useCallback((item: SelectableItem) => dispatch({ type: "toggle", item }), []);
  const toggleGroup = useCallback((items: SelectableItem[]) => dispatch({ type: "toggleGroup", items }), []);
  const clear = useCallback(() => dispatch({ type: "clear" }), []);

  const runFavorite = useCallback(() => {
    const hashes = selectedImageHashes(state);
    if (hashes.length) mutations.favorite(hashes, dir.favorite);
    clear();
  }, [state, mutations, dir.favorite, clear]);

  const runHide = useCallback(() => {
    const hashes = selectedImageHashes(state);
    if (hashes.length) mutations.hide(hashes, dir.hidden);
    clear();
  }, [state, mutations, dir.hidden, clear]);

  const runTrash = useCallback(() => {
    const hashes = selectedImageHashes(state);
    if (hashes.length) mutations.trash(hashes, dir.deleted);
    clear();
  }, [state, mutations, dir.deleted, clear]);

  const onPickAlbum = useCallback(
    (album: { id: number; title: string }) => {
      const items = selectedItems(state);
      const photoIds = selectedPhotoIds(state);
      const imageHashes = selectedImageHashes(state);
      if (photoIds.length) mutations.addToAlbum(album.id, album.title, photoIds, imageHashes);
      void items;
      setPickerOpen(false);
      clear();
    },
    [state, mutations, clear]
  );

  const onCreateAlbum = useCallback(
    (title: string) => {
      const photoIds = selectedPhotoIds(state);
      mutations.createAlbum(title, photoIds);
      setPickerOpen(false);
      clear();
    },
    [state, mutations, clear]
  );

  const runRemoveFromAlbum = useCallback(() => {
    if (!album) return;
    const photoIds = selectedPhotoIds(state);
    const imageHashes = selectedImageHashes(state);
    if (photoIds.length) mutations.removeFromAlbum(album.albumId, album.title, photoIds, imageHashes);
    clear();
  }, [album, state, mutations, clear]);

  const runShare = useCallback(() => {
    const hashes = selectedImageHashes(state);
    if (hashes.length === 0) return;
    setShareHashes(hashes);
    setShareOpen(true);
  }, [state]);

  const count = selectionCount(state);

  const overlay: ReactElement | null = state.active ? (
    <>
      <SelectionActionBar
        count={count}
        isOnline={isOnline}
        onFavorite={runFavorite}
        onHide={runHide}
        onTrash={runTrash}
        onAddToAlbum={() => setPickerOpen(true)}
        onRemoveFromAlbum={album ? runRemoveFromAlbum : undefined}
        onShareLink={runShare}
        onCancel={clear}
      />
      <AlbumPickerSheet
        visible={pickerOpen}
        onPick={onPickAlbum}
        onCreate={onCreateAlbum}
        onCancel={() => setPickerOpen(false)}
      />
      <ShareSheet
        visible={shareOpen}
        imageHashes={shareHashes}
        onClose={() => {
          setShareOpen(false);
          clear();
        }}
      />
    </>
  ) : null;

  return {
    active: state.active,
    count,
    isSelected: (key: string) => isSelectedSel(state, key),
    enter,
    toggle,
    toggleGroup,
    clear,
    overlay,
  };
}
