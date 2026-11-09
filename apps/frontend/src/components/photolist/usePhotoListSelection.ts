import type { BulkPhotoQuery, MediaType, PigPhoto } from "@librephotos/api-client";
import { useCallback, useMemo, useRef, useState } from "react";
import { nextSelection, selectedTiles, SELECTION_OFF } from "./photoListSelection";
import type { ListSelection, SelectionEvent } from "./photoListSelection";

/**
 * The selection of a photo list (`ListSelection`), changed only through `dispatch`. A change of
 * the media-type or timeline filter ends it: the photos on screen change, so a carried-over
 * selection (its count, or its select-all query) would be stale.
 */
export const usePhotoListSelection = (
  idx2hash: PigPhoto[],
  mediaType: MediaType | undefined,
  photosetQuery: BulkPhotoQuery | undefined
) => {
  // Callers pass photosetQuery as a fresh literal, so compare it by value.
  const scope = `${mediaType ?? ""}|${JSON.stringify(photosetQuery ?? null)}`;
  const [state, setState] = useState<{ scope: string; selection: ListSelection }>({
    scope,
    selection: SELECTION_OFF,
  });
  // Pig's stored callbacks may fire twice before a re-render (shift-click), and the click handler
  // reads the selection outside a render: both go through the ref, which always holds the latest.
  const selectionRef = useRef(state);
  if (state.scope !== scope) {
    // Adjusted while rendering, not in an effect, so no render shows the old selection.
    const cleared = { scope, selection: SELECTION_OFF };
    selectionRef.current = cleared;
    setState(cleared);
  }
  const selection = state.scope === scope ? state.selection : SELECTION_OFF;

  const dispatch = useCallback((event: SelectionEvent) => {
    const current = selectionRef.current;
    const next = { scope: current.scope, selection: nextSelection(current.selection, event) };
    selectionRef.current = next;
    setState(next);
  }, []);

  const handleSelection = useCallback((item: PigPhoto) => dispatch({ type: "toggle", item }), [dispatch]);
  const handleSelections = useCallback((items: PigPhoto[]) => dispatch({ type: "addRange", items }), [dispatch]);
  const readSelection = useCallback(() => selectionRef.current.selection, []);

  // Memoised so Pig's selection prop keeps its identity across unrelated re-renders.
  const pigSelectedItems = useMemo(() => [...selectedTiles(selection, idx2hash)], [selection, idx2hash]);

  return { selection, readSelection, dispatch, handleSelection, handleSelections, pigSelectedItems };
};
