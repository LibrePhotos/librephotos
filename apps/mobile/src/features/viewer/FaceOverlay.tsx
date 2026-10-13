import { View } from "react-native";
import type { ImageSource } from "expo-image";
import { useTheme } from "@/theme";
import { useImagePixelSize } from "./useImagePixelSize";

/**
 * A box drawn around one detected face on the photo.
 *
 * The web lightbox shows this on *hover* over a sidebar person; a touch screen
 * has no hover, so mobile shows it when a person chip is tapped and clears it on
 * the next tap (doc 07, capability #39).
 */

export type FaceLocation = { top: number; bottom: number; left: number; right: number };

export type Rect = { left: number; top: number; width: number; height: number };

/**
 * Where a `contentFit: "contain"` image actually lands inside its box.
 *
 * Face locations arrive in pixels of the image they were found on, but the photo
 * is letterboxed inside the slide, so mapping a face onto the screen means
 * knowing the rendered rectangle first. Returns null when either size is
 * degenerate (a payload without width/height, which does happen).
 */
export function containedRect(
  sourceWidth: number | null | undefined,
  sourceHeight: number | null | undefined,
  boxWidth: number,
  boxHeight: number
): Rect | null {
  if (!sourceWidth || !sourceHeight || sourceWidth <= 0 || sourceHeight <= 0) return null;
  if (boxWidth <= 0 || boxHeight <= 0) return null;
  const sourceAspect = sourceWidth / sourceHeight;
  const boxAspect = boxWidth / boxHeight;
  if (sourceAspect > boxAspect) {
    const height = boxWidth / sourceAspect;
    return { left: 0, top: (boxHeight - height) / 2, width: boxWidth, height };
  }
  const width = boxHeight * sourceAspect;
  return { left: (boxWidth - width) / 2, top: 0, width, height: boxHeight };
}

/**
 * Map a face's source-pixel box onto the rendered image rectangle.
 *
 * The backend also emits *normalized* (0..1) locations for some detectors, so a
 * box whose coordinates all sit within [0, 1] is treated as a fraction of the
 * source rather than as a 1-pixel face in the top-left corner.
 */
export function faceRect(
  location: FaceLocation,
  sourceWidth: number | null | undefined,
  sourceHeight: number | null | undefined,
  boxWidth: number,
  boxHeight: number
): Rect | null {
  // containedRect has no rect without both source dimensions either.
  if (!sourceWidth || !sourceHeight) return null;
  const image = containedRect(sourceWidth, sourceHeight, boxWidth, boxHeight);
  if (!image) return null;
  const { top, bottom, left, right } = location;
  if (!(right > left) || !(bottom > top)) return null;

  const normalized = right <= 1 && bottom <= 1 && left >= 0 && top >= 0;
  const denomX = normalized ? 1 : sourceWidth;
  const denomY = normalized ? 1 : sourceHeight;

  return {
    left: image.left + (left / denomX) * image.width,
    top: image.top + (top / denomY) * image.height,
    width: ((right - left) / denomX) * image.width,
    height: ((bottom - top) / denomY) * image.height,
  };
}

/**
 * The server finds faces on the photo's big thumbnail and sends their boxes in
 * its pixels (#2577), so `faceSpace` is that image: its loaded size maps the box,
 * whichever image the slide shows (the big thumbnail, the original, a camera-roll
 * file). The photo's own width and height are the original's, which is larger.
 * Nothing is drawn until the size is known.
 */
export function FaceOverlay({
  location,
  faceSpace,
  boxWidth,
  boxHeight,
  testID,
}: {
  location: FaceLocation;
  faceSpace: ImageSource;
  boxWidth: number;
  boxHeight: number;
  testID?: string;
}) {
  const theme = useTheme();
  const size = useImagePixelSize(faceSpace);
  const rect = faceRect(location, size?.width, size?.height, boxWidth, boxHeight);
  if (!rect) return null;
  return (
    <View
      testID={testID}
      // Never swallow a swipe or a pinch — this is decoration.
      pointerEvents="none"
      style={{
        position: "absolute",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        borderWidth: 2,
        borderColor: theme.brand,
        borderRadius: 8,
        shadowColor: "#000",
        shadowOpacity: 0.4,
        shadowRadius: 6,
      }}
    />
  );
}
