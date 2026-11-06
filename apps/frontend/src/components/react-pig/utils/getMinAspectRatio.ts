/**
 * Get the minimum required aspect ratio for a valid row of images. The
 * perfect rows are maintained by building up a row of images by adding
 * together their aspect ratios (the aspect ratio when they are placed
 * next to each other) until that aspect ratio exceeds the value returned
 * by this function. Responsive reordering is achieved through changes
 * to what this function returns at different values of the passed
 * parameter `containerWidth`.
 *
 * @param containerWidth - The last computed width of the container
 * @param scaleOfImages - The size of the images
 * @returns The minimum aspect ratio at this window width.
 */
export default function getMinAspectRatio(containerWidth: number, scaleOfImages: number): number {
  // Rows of about 120 px on a phone and 230-260 px on a desktop, as in Google Photos and Immich: a
  // lone landscape photo no longer fills half the screen.
  if (containerWidth <= 480) return 2.6 * scaleOfImages;
  if (containerWidth <= 800) return 3.6 * scaleOfImages;
  if (containerWidth <= 1280) return 5 * scaleOfImages;
  if (containerWidth <= 1920) return 6 * scaleOfImages;
  return 7.5 * scaleOfImages;
}
