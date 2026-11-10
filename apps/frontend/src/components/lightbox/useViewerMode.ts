import { useCallback, useContext, useSyncExternalStore, type SetStateAction } from "react";
import { useKeyedState } from "../../hooks/useKeyedState";
import { usePanoramaMode } from "../panorama/usePanoramaMode";
import { UnsavedDraftsContext } from "./unsavedDrafts";
import { useFaceDrawing } from "./useFaceDrawing";
import { useLightboxZoom } from "./useLightboxZoom";
import { usePhotoRotation } from "./usePhotoRotation";

/**
 * What the viewer is doing with the photo shown. Zoom and live text can be on together (the text
 * rides on the magnified photo), so this names the one that matters most; anything but
 * "browsing" holds the slideshow.
 */
type ViewerMode = "browsing" | "panorama" | "drawingFace" | "zoomed" | "liveText";

type ModeFlags = { panorama: boolean; drawingFace: boolean; zoomed: boolean; liveText: boolean };

function viewerMode(flags: ModeFlags): ViewerMode {
  if (flags.panorama) return "panorama";
  if (flags.drawingFace) return "drawingFace";
  if (flags.zoomed) return "zoomed";
  if (flags.liveText) return "liveText";
  return "browsing";
}

type Args = {
  mainSrc: string;
  mainSrcHash: string;
  /** The item is a still: zoom and live text apply (a video's details can arrive after a Z). */
  still: boolean;
  /** The photo shown is a photo sphere: the 360° view can be turned on. */
  sphere: boolean;
  /** A face is about to be drawn: the hover box of a listed face would cover it. */
  onStartFace: () => void;
};

/**
 * The lightbox's modes for the photo shown: zoom, the 360° view, marking a face, live text, a
 * rotation on its way and whether a video plays. Each is keyed to the photo, so the next one starts
 * browsing (unrotated, a video playing) from its first render. The slideshow is `held` while any
 * mode is on or an edit is unsaved: a slideshow step would then ask to discard it.
 */
export function useViewerMode({ mainSrc, mainSrcHash, still, sphere, onStartFace }: Args) {
  const zoom = useLightboxZoom(mainSrc);
  const panorama = usePanoramaMode({ sphere, photoKey: mainSrc });
  const exitPanorama = panorama.exit;
  // A face is drawn on the flat photo, not on the sphere.
  const startFace = useCallback(() => {
    onStartFace();
    exitPanorama();
  }, [onStartFace, exitPanorama]);
  const faceDrawing = useFaceDrawing(mainSrcHash, startFace);
  const rotation = usePhotoRotation(mainSrcHash, mainSrc);
  const [playing, updatePlaying] = useKeyedState(mainSrc, () => true);
  const setPlaying = useCallback(
    (next: SetStateAction<boolean>) => updatePlaying(current => (typeof next === "boolean" ? next : next(current))),
    [updatePlaying]
  );
  const [showOcrText, updateShowOcrText] = useKeyedState(mainSrc, () => false);
  const toggleOcrText = useCallback(() => updateShowOcrText(shown => !shown), [updateShowOcrText]);

  const drafts = useContext(UnsavedDraftsContext);
  const unsaved = useSyncExternalStore(drafts.subscribe, drafts.dirtyFields).length > 0;
  const mode = viewerMode({
    panorama: panorama.active,
    drawingFace: faceDrawing.isDrawing || faceDrawing.drawnBox !== null,
    zoomed: still && zoom.isMagnified,
    liveText: still && showOcrText,
  });

  return {
    zoom,
    panorama,
    faceDrawing,
    rotation,
    playing,
    setPlaying,
    showOcrText,
    toggleOcrText,
    held: mode !== "browsing" || unsaved,
  };
}
