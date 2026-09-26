/**
 * Copying a photo, as an image, to the system clipboard.
 *
 * The browser's own "Copy image" on the right-click menu already works on the
 * lightbox picture, but it is invisible on touch devices and nobody discovers
 * it from a toolbar. This is the programmatic route behind the toolbar button
 * and the Ctrl/Cmd+C shortcut.
 *
 * Two browser constraints shape the code:
 *
 * - Chrome accepts only PNG on the image clipboard, and the lightbox shows
 *   WebP thumbnails, so the bytes are re-encoded through a canvas.
 * - Safari revokes the user gesture the moment a handler awaits anything, and
 *   then refuses `clipboard.write` with NotAllowedError. The fix is to hand
 *   `ClipboardItem` a *promise* of the PNG and call `write` synchronously: the
 *   gesture is consumed at once and the bytes may arrive later. Chrome and
 *   Firefox 127+ accept the promise form too.
 */

/**
 * Whether this page can put images on the clipboard at all.
 *
 * `navigator.clipboard` exists only in secure contexts, so a LibrePhotos
 * instance served over plain HTTP on a LAN has no image clipboard, and the UI
 * should hide the action rather than fail on every click.
 */
export function canCopyImagesToClipboard(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext === true &&
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  );
}

/** Fetch `url` and return its bytes as a PNG, re-encoding if they are not one already. */
async function fetchAsPng(url: string): Promise<Blob> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Fetching the image failed with HTTP ${response.status}`);
  }
  const source = await response.blob();
  if (source.type === "image/png") {
    return source;
  }

  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context unavailable");
    }
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))), "image/png");
    });
  } finally {
    bitmap.close();
  }
}

/**
 * Copy the image at `url` to the clipboard as PNG.
 *
 * Call it synchronously from the click or key handler; see the module comment
 * for why nothing may be awaited before `write`. Resolves once the clipboard
 * holds the image and rejects if the fetch, the encoding or the clipboard
 * itself fails.
 */
export function copyImageToClipboard(url: string): Promise<void> {
  const png = fetchAsPng(url);
  return navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
