import type { NormalizedFaceBox } from "@librephotos/api-client";
import { useCallback } from "react";
import { useAddFaceMutation } from "../../api_client/faces";
import { drawnFaceResults } from "../../api_client/faces/drawnFaceResults";
import { useKeyedState } from "../../hooks/useKeyedState";

/** Where marking a face is: not at all, a box being dragged, or a box waiting for its name. */
type FaceDrawing =
  Readonly<{ step: "idle" }> | Readonly<{ step: "drawing" }> | Readonly<{ step: "naming"; box: NormalizedFaceBox }>;

const IDLE: FaceDrawing = { step: "idle" };

/**
 * Marking a face the detector missed, shared by the lightbox and the photo
 * page: the user drags a box over the photo (`isDrawing`, MediaDisplay's
 * drawing layer), then names whoever is in it (`drawnBox` opens the person
 * picker). The box only has to be rough: the server looks for the face in
 * it (#1117), and the People section says what it found. Another photo
 * starts idle from its first render, so a box half drawn or not yet named
 * never lands on it.
 */
export function useFaceDrawing(imageHash: string | undefined, onStart?: () => void) {
  const [drawing, setDrawing] = useKeyedState(imageHash ?? "", () => IDLE);
  const { mutate: addFace } = useAddFaceMutation();

  const start = useCallback(() => {
    // Drawing again leaves the box no face was found in
    if (imageHash) drawnFaceResults.clear(imageHash);
    onStart?.();
    setDrawing(() => ({ step: "drawing" }));
  }, [imageHash, onStart, setDrawing]);

  const cancel = useCallback(() => setDrawing(() => IDLE), [setDrawing]);

  const onDrawn = useCallback((box: NormalizedFaceBox) => setDrawing(() => ({ step: "naming", box })), [setDrawing]);

  const drawnBox = drawing.step === "naming" ? drawing.box : null;
  const onPersonChosen = useCallback(
    (personName: string) => {
      if (!drawnBox || !imageHash) return;
      addFace({ photo: imageHash, personName, box: drawnBox, fit: true });
      setDrawing(() => IDLE);
    },
    [addFace, drawnBox, imageHash, setDrawing]
  );

  return { isDrawing: drawing.step === "drawing", drawnBox, start, cancel, onDrawn, onPersonChosen };
}
