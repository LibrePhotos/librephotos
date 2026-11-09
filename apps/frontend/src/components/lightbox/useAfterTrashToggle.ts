import { useRef } from "react";

type Args = {
  mainSrc: string;
  mainSrcHash: string;
  nextSrc: string | null;
  prevSrc: string | null;
  onMoveNextRequest: () => void;
  onMovePrevRequest: () => void;
  onClose: () => void;
  /** The lightbox's own step after a trash toggle (see ContentViewerProps); false to close. */
  onTrashToggled?: (id: string) => boolean;
};

/**
 * What the viewer does once its photo was moved to (or, in the trash, restored from) the trash: the
 * photo leaves the list it was opened from, so step to a neighbour rather than leave it on screen.
 *
 * The returned handler runs when the request succeeds, from the render the click was made in, so
 * `mainSrc` is the photo that was trashed. The lightbox steps by its own list; a viewer without one
 * (a stack) steps to its next or previous photo, unless the user has moved on meanwhile: stepping
 * from that photo would jump them back to its neighbour.
 */
export function useAfterTrashToggle(args: Args) {
  const { mainSrc, mainSrcHash, nextSrc, prevSrc, onMoveNextRequest, onMovePrevRequest, onClose, onTrashToggled } =
    args;
  const shownHashRef = useRef(mainSrcHash);
  shownHashRef.current = mainSrcHash;
  return () => {
    if (onTrashToggled) {
      if (!onTrashToggled(mainSrc)) onClose();
      return;
    }
    if (shownHashRef.current !== mainSrcHash) return;
    if (nextSrc) onMoveNextRequest();
    else if (prevSrc) onMovePrevRequest();
    else onClose();
  };
}
