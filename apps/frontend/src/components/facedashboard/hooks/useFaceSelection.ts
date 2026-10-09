import type React from "react";
import { useCallback, useState } from "react";
import { FaceCell, FaceSelection, GridCell, isPersonCell } from "./useVirtualizedGrid";

/** A face in a shift-click range that can be selected: paged in, so it has its image. */
function isSelectableFace(cell: GridCell): cell is FaceCell {
  return !isPersonCell(cell) && !!cell.image && cell.face_url !== null;
}

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
          const lastSelectedFace = { face_id: lastChecked.id, face_url: lastChecked.face_url };
          return [lastSelectedFace, ...merged.filter(face => !duplicates.some(d => d.face_id === face.face_id))];
        }

        return merged.filter(face => !duplicates.some(d => d.face_id === face.face_id));
      });
    },
    [lastChecked]
  );

  const onFaceSelect = useCallback((face: FaceSelection) => {
    setSelectedFaces(prev =>
      prev.some(f => f.face_url === face.face_url)
        ? prev.filter(item => item.face_url !== face.face_url)
        : [...prev, face]
    );
  }, []);

  const handleCellClick = useCallback(
    (e: React.MouseEvent, cell: FaceCell) => {
      if (!lastChecked) {
        setLastChecked(cell);
        onFaceSelect({ face_id: cell.id, face_url: cell.face_url });
        return;
      }

      if (e.shiftKey) {
        // Get the faces in range between the current cell and lastChecked
        const facesInRange = getFacesInRange(cell, lastChecked);

        const facesToSelect = facesInRange
          .filter(isSelectableFace)
          .map(face => ({ face_id: face.id, face_url: face.face_url }));

        onFacesSelect(facesToSelect);
        setLastChecked(cell);
        return;
      }

      onFaceSelect({ face_id: cell.id, face_url: cell.face_url });
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
