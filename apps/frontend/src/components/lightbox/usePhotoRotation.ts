import { useCallback, useEffect } from "react";
import { useRotatePhotosMutation } from "../../api_client/photos/hooks/useRotatePhotosMutation";
import { useKeyedState } from "../../hooks/useKeyedState";

/**
 * A rotation of the photo shown: `angle` is the CSS rotation still applied, `cacheKey` versions
 * the image once the server has rotated it. `awaitingImage` while that rotated image loads, then
 * `snapping` for the one render that sets the angle back to 0 without a transition.
 */
type Rotation = Readonly<{ angle: number; cacheKey: number; step: "idle" | "awaitingImage" | "snapping" }>;

const UNROTATED: Rotation = { angle: 0, cacheKey: 0, step: "idle" };

/**
 * Rotating a photo in 90° steps, shared by the lightbox and the photo page.
 *
 * The photo turns at once (a CSS rotation) while the server rotates it; once
 * the rotated thumbnail has loaded (`onImageLoad`), the CSS angle snaps back
 * to 0 without a transition, so the swap is invisible. Pass the rotation
 * state to MediaDisplay; `imageCacheKey` also versions a copy to the clipboard.
 *
 * `resetKey` is what is shown (the lightbox's current slide): another one
 * starts unrotated from its first render, and an answer for the previous
 * photo's rotation does not reach it.
 */
export function usePhotoRotation(imageHash: string | undefined, resetKey: string | undefined) {
  const [rotation, setRotation] = useKeyedState(resetKey ?? "", () => UNROTATED);
  const { mutate: rotatePhotos } = useRotatePhotosMutation();

  // Re-enable the transition in the next frame, so the suppression lasts
  // exactly the one render that resets the angle to 0.
  const snapping = rotation.step === "snapping";
  useEffect(() => {
    if (!snapping) return;
    const raf = requestAnimationFrame(() =>
      setRotation(current => (current.step === "snapping" ? { ...current, step: "idle" } : current))
    );
    return () => cancelAnimationFrame(raf);
  }, [snapping, setRotation]);

  // `angle` is the visual rotation (positive = clockwise); the mutation turns it
  // into the server's angle and names the direction in its toast.
  const rotate = useCallback(
    (angle: number) => {
      if (!imageHash) return;
      setRotation(current => ({ ...current, angle: current.angle + angle }));
      rotatePhotos(
        { image_hash: imageHash, clockwiseDegrees: angle },
        {
          // The image is still loading: snap back once it has arrived.
          onSuccess: () => setRotation(current => ({ ...current, cacheKey: Date.now(), step: "awaitingImage" })),
          // The image will not reload, so turn back at once.
          onError: () => setRotation(current => ({ ...current, angle: 0 })),
        }
      );
    },
    [imageHash, rotatePhotos, setRotation]
  );

  const onImageLoad = useCallback(
    () =>
      setRotation(current => (current.step === "awaitingImage" ? { ...current, angle: 0, step: "snapping" } : current)),
    [setRotation]
  );

  return {
    rotationAngle: rotation.angle,
    imageCacheKey: rotation.cacheKey,
    suppressRotationTransition: snapping,
    rotate,
    onImageLoad,
  };
}
