import { createContext, useContext } from "react";

/**
 * Opens the photo editor on the photo the lightbox shows. The lightbox provides it for a photo the
 * viewer owns; elsewhere (a public page, a shared library, someone else's photo, the photo page)
 * there is none and the toolbar shows no Edit button.
 */
export const PhotoEditorLauncherContext = createContext<(() => void) | null>(null);

export function usePhotoEditorLauncher(): (() => void) | null {
  return useContext(PhotoEditorLauncherContext);
}
