import { useImage, type ImageSource } from "expo-image";

export type PixelSize = { width: number; height: number };

/**
 * The size in pixels of the image at `source`, or null until it has loaded (and
 * when it cannot be loaded). expo-image reports a logical size; times its scale
 * that is the decoded image's pixels.
 */
export function useImagePixelSize(source: ImageSource): PixelSize | null {
  const image = useImage(source);
  if (!image) return null;
  return { width: image.width * image.scale, height: image.height * image.scale };
}
