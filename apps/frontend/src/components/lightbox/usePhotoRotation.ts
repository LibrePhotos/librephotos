import { useCallback, useEffect, useRef, useState } from "react";
import { useRotatePhotosMutation } from "../../api_client/photos/hooks/useRotatePhotosMutation";

/**
 * Rotating a photo in 90° steps, shared by the lightbox and the photo page.
 *
 * The photo turns at once (a CSS rotation) while the server rotates it; once
 * the rotated thumbnail has loaded (`onImageLoad`), the CSS angle snaps back
 * to 0 without a transition, so the swap is invisible. Pass the rotation
 * state to MediaDisplay; `imageCacheKey` also versions a copy to the clipboard.
 *
 * `resetKey` is what is shown (the lightbox's current slide): when it changes,
 * a rotation of the previous photo is not carried over.
 */
export function usePhotoRotation(imageHash: string | undefined, resetKey: string | undefined) {
  const [rotationAngle, setRotationAngle] = useState(0);
  const [imageCacheKey, setImageCacheKey] = useState(0);
  // Skip the rotation's CSS transition on the next render (the silent snap back to 0).
  const [suppressRotationTransition, setSuppressRotationTransition] = useState(false);
  // True while the rotated image is on its way after the server rotated the photo.
  const pendingRotationReset = useRef(false);
  const { mutate: rotatePhotos } = useRotatePhotosMutation();

  useEffect(() => {
    setRotationAngle(0);
    setImageCacheKey(0);
    pendingRotationReset.current = false;
    setSuppressRotationTransition(false);
  }, [resetKey]);

  // Re-enable the transition in the next frame, so the suppression lasts
  // exactly the one render that resets the angle to 0.
  useEffect(() => {
    if (!suppressRotationTransition) return;
    const raf = requestAnimationFrame(() => setSuppressRotationTransition(false));
    return () => cancelAnimationFrame(raf);
  }, [suppressRotationTransition]);

  // `angle` is the visual rotation (positive = clockwise); the mutation turns it
  // into the server's angle and names the direction in its toast.
  const rotate = useCallback(
    (angle: number) => {
      if (!imageHash) return;
      setRotationAngle(prev => prev + angle);
      rotatePhotos(
        { image_hash: imageHash, clockwiseDegrees: angle },
        {
          onSuccess: () => {
            // The image is still loading: snap back once it has arrived.
            pendingRotationReset.current = true;
            setImageCacheKey(Date.now());
          },
          // The image will not reload, so turn back at once.
          onError: () => setRotationAngle(0),
        }
      );
    },
    [imageHash, rotatePhotos]
  );

  const onImageLoad = useCallback(() => {
    if (!pendingRotationReset.current) return;
    pendingRotationReset.current = false;
    setSuppressRotationTransition(true);
    setRotationAngle(0);
  }, []);

  return { rotationAngle, imageCacheKey, suppressRotationTransition, rotate, onImageLoad };
}
