import type { NormalizedFaceBox } from "@librephotos/api-client";
import { useCallback, useEffect, useState } from "react";
import { useAddFaceMutation } from "../../api_client/faces";

/**
 * Marking a face the detector missed, shared by the lightbox and the photo
 * page: the user drags a box over the photo (`isDrawing`, MediaDisplay's
 * drawing layer), then names whoever is in it (`drawnBox` opens the person
 * picker). Moving to another photo drops a box half drawn or not yet named,
 * so it never lands on the next one.
 */
export function useFaceDrawing(imageHash: string | undefined, onStart?: () => void) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawnBox, setDrawnBox] = useState<NormalizedFaceBox | null>(null);
  const { mutate: addFace } = useAddFaceMutation();

  const start = useCallback(() => {
    onStart?.();
    setIsDrawing(true);
  }, [onStart]);

  const cancel = useCallback(() => {
    setIsDrawing(false);
    setDrawnBox(null);
  }, []);

  const onDrawn = useCallback((box: NormalizedFaceBox) => {
    setIsDrawing(false);
    setDrawnBox(box);
  }, []);

  const onPersonChosen = useCallback(
    (personName: string) => {
      if (!drawnBox || !imageHash) return;
      addFace({ photo: imageHash, personName, box: drawnBox });
      setDrawnBox(null);
    },
    [addFace, drawnBox, imageHash]
  );

  useEffect(() => {
    setIsDrawing(false);
    setDrawnBox(null);
  }, [imageHash]);

  return { isDrawing, drawnBox, start, cancel, onDrawn, onPersonChosen };
}
