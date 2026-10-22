import type { NormalizedFaceBox } from "@librephotos/api-client";
import { useCallback, useEffect, useState } from "react";
import { isNoFaceInBox, useAddFaceMutation } from "../../api_client/faces";

/**
 * What became of the last box drawn (#1117): the server is looking for the face in it, or found
 * none there. "idle" otherwise.
 */
export type FaceDrawResult = Readonly<{
  state: "idle" | "finding" | "notfound";
  /** Save the box as drawn, under the name already chosen. */
  keepBox: () => void;
  /** Leave the box and draw another one. */
  drawAgain: () => void;
}>;

/**
 * Marking a face the detector missed, shared by the lightbox and the photo
 * page: the user drags a box over the photo (`isDrawing`, MediaDisplay's
 * drawing layer), then names whoever is in it (`drawnBox` opens the person
 * picker). The box only has to be rough: the server looks for the face inside
 * it and saves the face it finds (#1117); when there is none, `result` offers
 * to keep the box as drawn or to draw again. Moving to another photo drops a
 * box half drawn or not yet named, so it never lands on the next one.
 */
export function useFaceDrawing(imageHash: string | undefined, onStart?: () => void) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawnBox, setDrawnBox] = useState<NormalizedFaceBox | null>(null);
  const addFace = useAddFaceMutation();
  const { mutate, reset, variables } = addFace;

  const start = useCallback(() => {
    reset();
    onStart?.();
    setIsDrawing(true);
  }, [onStart, reset]);

  const cancel = useCallback(() => {
    reset();
    setIsDrawing(false);
    setDrawnBox(null);
  }, [reset]);

  const onDrawn = useCallback((box: NormalizedFaceBox) => {
    setIsDrawing(false);
    setDrawnBox(box);
  }, []);

  const onPersonChosen = useCallback(
    (personName: string) => {
      if (!drawnBox || !imageHash) return;
      mutate({ photo: imageHash, personName, box: drawnBox, fit: true });
      setDrawnBox(null);
    },
    [mutate, drawnBox, imageHash]
  );

  const keepBox = useCallback(() => {
    if (variables) mutate({ ...variables, fit: false });
  }, [mutate, variables]);

  useEffect(() => {
    setIsDrawing(false);
    setDrawnBox(null);
    reset();
  }, [imageHash, reset]);

  const result: FaceDrawResult = {
    state: resultState(addFace.isPending, variables?.fit === true, isNoFaceInBox(addFace.error)),
    keepBox,
    drawAgain: start,
  };
  return { isDrawing, drawnBox, start, cancel, onDrawn, onPersonChosen, result };
}

/** The face drawing of the lightbox or the photo page. */
export type FaceDrawing = ReturnType<typeof useFaceDrawing>;

function resultState(pending: boolean, fitting: boolean, noFace: boolean): FaceDrawResult["state"] {
  if (pending && fitting) return "finding";
  return noFace ? "notfound" : "idle";
}
