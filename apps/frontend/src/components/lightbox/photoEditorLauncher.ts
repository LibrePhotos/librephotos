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

/**
 * The editor was just closed: the Edit button that opened it was unmounted with the viewer, so the
 * viewer, coming back, puts the focus on its new Edit button (`data-autofocus`) instead of its body.
 */
export const EditorClosedContext = createContext(false);

export function useEditorJustClosed(): boolean {
  return useContext(EditorClosedContext);
}
