import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BulkPhotoQuery, PigPhoto, SelectionState } from "../../api_client/photos/types";
import type { MediaType } from "./mediaTypeFilter";

// The selection of a photo list: the selected tiles, select mode, and select all
// (which then tracks the excluded tiles instead).
export const usePhotoListSelection = (
  idx2hash: PigPhoto[],
  mediaType: MediaType | undefined,
  photosetQuery: BulkPhotoQuery | undefined
) => {
  const [selectionState, setSelectionState] = useState<SelectionState>({
    selectedItems: [],
    selectMode: false,
    selectAllMode: false,
    selectAllQuery: undefined,
    totalCount: undefined,
  });
  const selectionStateRef = useRef(selectionState);

  // Merge into the ref, not the render-time `selectionState`: callers such as
  // handleSelection run from Pig's stored callbacks and may fire twice before a
  // re-render (shift-click), so the closure value can be stale.
  const updateSelectionState = useCallback((newState: Partial<SelectionState>) => {
    const updatedState = { ...selectionStateRef.current, ...newState };
    selectionStateRef.current = updatedState;
    setSelectionState(updatedState);
  }, []);

  // Clear any active selection when the media-type or timeline filter changes:
  // the set of photos on screen changes, so a carried-over selection (and its
  // "N selected" count or server-side select-all query) would be stale and
  // misleading. Callers pass photosetQuery as a fresh literal, so compare it
  // by value.
  const photosetQueryKey = JSON.stringify(photosetQuery ?? null);
  useEffect(() => {
    const cleared: SelectionState = {
      selectedItems: [],
      selectMode: false,
      selectAllMode: false,
      selectAllQuery: undefined,
      totalCount: undefined,
    };
    selectionStateRef.current = cleared;
    setSelectionState(cleared);
  }, [mediaType, photosetQueryKey]);

  const handleSelection = useCallback(
    (item: PigPhoto) => {
      const currentState = selectionStateRef.current;

      // In selectAllMode, selectedItems tracks EXCLUDED items
      if (currentState.selectAllMode) {
        const isExcluded = currentState.selectedItems.find(i => i.id === item.id);
        if (isExcluded) {
          // Re-include by removing from exclusions
          updateSelectionState({
            selectedItems: currentState.selectedItems.filter(i => i.id !== item.id),
          });
        } else {
          // Exclude by adding to list
          updateSelectionState({
            selectedItems: [...currentState.selectedItems, item],
          });
        }
        return;
      }

      // Normal selection mode
      let newSelectedItems = currentState.selectedItems;

      if (newSelectedItems.find(selectedItem => selectedItem.id === item.id)) {
        newSelectedItems = newSelectedItems.filter(value => value.id !== item.id);
      } else {
        newSelectedItems = newSelectedItems.concat(item);
      }

      updateSelectionState({
        selectedItems: newSelectedItems,
        selectMode: newSelectedItems.length > 0,
      });
    },
    [updateSelectionState]
  );

  // Shift-click selects the whole range, like a file manager: items already
  // selected stay selected (toggling deselected them), and not-yet-loaded
  // placeholders are skipped. In selectAllMode selectedItems holds the
  // exclusions, so the range is excluded, as a plain click excludes one item.
  const handleSelections = useCallback(
    (items: PigPhoto[]) => {
      const current = selectionStateRef.current;
      const added = items.filter(
        item => !item.isTemp && !current.selectedItems.some(selectedItem => selectedItem.id === item.id)
      );
      const newSelectedItems = current.selectedItems.concat(added);
      if (current.selectAllMode) {
        updateSelectionState({ selectedItems: newSelectedItems });
        return;
      }
      updateSelectionState({
        selectedItems: newSelectedItems,
        selectMode: newSelectedItems.length > 0,
      });
    },
    [updateSelectionState]
  );

  // In selectAllMode, all real (non-temp) items are selected except the
  // exclusions tracked in selectedItems. Memoised so Pig's selection prop keeps
  // its identity across unrelated re-renders.
  const pigSelectedItems = useMemo(
    () =>
      selectionState.selectAllMode
        ? idx2hash.filter(
            item => !item.isTemp && !selectionState.selectedItems.find(excluded => excluded.id === item.id)
          )
        : selectionState.selectedItems,
    [idx2hash, selectionState.selectAllMode, selectionState.selectedItems]
  );

  return {
    selectionState,
    selectionStateRef,
    updateSelectionState,
    handleSelection,
    handleSelections,
    pigSelectedItems,
  };
};
