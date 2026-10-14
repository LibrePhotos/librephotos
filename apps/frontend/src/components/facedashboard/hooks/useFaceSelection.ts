import type React from "react";
import { useCallback, useState } from "react";
import type { FaceCell, FaceSelection, GridCell } from "./useVirtualizedGrid";
import { isLoadedFace, selectionOf } from "./useVirtualizedGrid";

// Custom hook to manage face selection
export function useFaceSelection(getFacesInRange: (start: FaceCell, end: FaceCell) => GridCell[]) {
  const [lastChecked, setLastChecked] = useState<FaceCell | null>(null);
  const [selectedFaces, setSelectedFaces] = useState<FaceSelection[]>([]);

  const onFacesSelect = useCallback(
    (faces: FaceSelection[]) => {
      setSelectedFaces(prev => {
        const duplicates = faces.filter(face => prev.some(i => i.face_id === face.face_id));
        // Every id comes from prev or faces, so each finds its face
        const merged = Array.from(new Set([...prev, ...faces].map(el => el.face_id))).flatMap(id => {
          const face = faces.find(f => f.face_id === id) ?? prev.find(f => f.face_id === id);
          return face ? [face] : [];
        });

        // If there are no duplicates, add the last checked face to the selection
        if (duplicates.length !== faces.length && lastChecked) {
          return [
            selectionOf(lastChecked),
            ...merged.filter(face => !duplicates.some(d => d.face_id === face.face_id)),
          ];
        }

        return merged.filter(face => !duplicates.some(d => d.face_id === face.face_id));
      });
    },
    [lastChecked]
  );

  const onFaceSelect = useCallback((face: FaceSelection) => {
    // By id: faces without a crop all have a null URL (#2636)
    setSelectedFaces(prev =>
      prev.some(f => f.face_id === face.face_id) ? prev.filter(item => item.face_id !== face.face_id) : [...prev, face]
    );
  }, []);

  const handleCellClick = useCallback(
    (e: React.MouseEvent, cell: FaceCell) => {
      if (!lastChecked) {
        setLastChecked(cell);
        onFaceSelect(selectionOf(cell));
        return;
      }

      if (e.shiftKey) {
        // Get the faces in range between the current cell and lastChecked
        const facesInRange = getFacesInRange(cell, lastChecked);

        // Every paged-in face, with or without its crop; placeholders have no real id yet
        const facesToSelect = facesInRange.filter(isLoadedFace).map(selectionOf);

        onFacesSelect(facesToSelect);
        setLastChecked(cell);
        return;
      }

      onFaceSelect(selectionOf(cell));
      setLastChecked(cell);
    },
    [lastChecked, onFaceSelect, onFacesSelect, setLastChecked, getFacesInRange]
  );

  return {
    selectedFaces,
    setSelectedFaces,
    lastChecked,
    setLastChecked,
    onFaceSelect,
    onFacesSelect,
    handleCellClick,
    // Also forget the shift-click anchor, which may not be on screen any more
    clearSelection: useCallback(() => {
      setSelectedFaces([]);
      setLastChecked(null);
    }, []),
  };
}
