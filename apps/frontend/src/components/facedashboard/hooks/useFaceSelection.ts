import type React from "react";
import { useCallback, useState } from "react";
import type { FaceCell, FaceSelection, GridCell } from "./useVirtualizedGrid";
import { isLoadedFace, selectionOf } from "./useVirtualizedGrid";

/** The selected faces, the shift-click anchor, and the list (`scope`) they were picked in. */
type SelectionState = Readonly<{ scope: string; faces: FaceSelection[]; anchor: FaceCell | null }>;

const emptyIn = (scope: string): SelectionState => ({ scope, faces: [], anchor: null });

/** A shift-click range: faces already selected leave it, the others (and the anchor) join it. */
function withRange(prev: FaceSelection[], faces: FaceSelection[], anchor: FaceCell | null): FaceSelection[] {
  const duplicates = faces.filter(face => prev.some(i => i.face_id === face.face_id));
  // Every id comes from prev or faces, so each finds its face
  const merged = Array.from(new Set([...prev, ...faces].map(el => el.face_id))).flatMap(id => {
    const face = faces.find(f => f.face_id === id) ?? prev.find(f => f.face_id === id);
    return face ? [face] : [];
  });
  const kept = merged.filter(face => !duplicates.some(d => d.face_id === face.face_id));
  // If there are no duplicates, add the last checked face to the selection
  return duplicates.length !== faces.length && anchor ? [selectionOf(anchor), ...kept] : kept;
}

// By id: faces without a crop all have a null URL (#2636)
const toggled = (prev: FaceSelection[], face: FaceSelection) =>
  prev.some(f => f.face_id === face.face_id) ? prev.filter(item => item.face_id !== face.face_id) : [...prev, face];

/**
 * The faces selected on the dashboard. `scope` names the list on screen (tab, filters, order): when
 * it changes, the selection is dropped with it, so Delete, Not this person and Add never act on
 * faces that are no longer shown.
 */
export function useFaceSelection(getFacesInRange: (start: FaceCell, end: FaceCell) => GridCell[], scope = "") {
  const [state, setState] = useState<SelectionState>(() => emptyIn(scope));
  if (state.scope !== scope) {
    // Adjusted while rendering, not in an effect, so no render shows the other list's selection
    setState(emptyIn(scope));
  }
  const current = state.scope === scope ? state : emptyIn(scope);

  const setSelectedFaces = useCallback((faces: FaceSelection[]) => setState(prev => ({ ...prev, faces })), []);

  // The faces an action was sent for leave the selection once the server took it; a failure keeps them
  const dropFaces = useCallback((faceIds: readonly number[]) => {
    setState(prev => ({ ...prev, faces: prev.faces.filter(face => !faceIds.includes(face.face_id)) }));
  }, []);

  const handleCellClick = useCallback(
    (e: Pick<React.MouseEvent, "shiftKey">, cell: FaceCell) => {
      setState(prev => {
        if (prev.anchor && e.shiftKey) {
          // Every paged-in face, with or without its crop; placeholders have no real id yet
          const range = getFacesInRange(cell, prev.anchor).filter(isLoadedFace).map(selectionOf);
          return { ...prev, faces: withRange(prev.faces, range, prev.anchor), anchor: cell };
        }
        return { ...prev, faces: toggled(prev.faces, selectionOf(cell)), anchor: cell };
      });
    },
    [getFacesInRange]
  );

  return {
    selectedFaces: current.faces,
    setSelectedFaces,
    dropFaces,
    handleCellClick,
    // Also forget the shift-click anchor, which may not be on screen any more
    clearSelection: useCallback(() => setState(prev => emptyIn(prev.scope)), []),
  };
}
