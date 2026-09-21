import { useState } from "react";
import { PigPhoto } from "../../api_client/photos/types";

/**
 * Keeps a page in step with the photo its lightbox is showing.
 *
 * `Lightbox` is a controlled component: it snaps back to `selectedImage`
 * whenever that differs from the photo on screen. A parent that passes a fixed
 * value therefore gets a slideshow that replays its first photo for ever, which
 * is what happened to "play all" before this existed. The hook holds the photo
 * being shown, starting at the first of `items`, and hands back the two props
 * the lightbox needs.
 */
export function useSlideshowSelection(items: PigPhoto[]) {
  const [shownId, setShownId] = useState<string | null>(null);

  const first = items.length > 0 ? items[0].id : null;
  // A photo that is not in the list -- the previous memory's, or one deleted
  // from under us -- gives way to the first, rather than leaving the lightbox
  // pinned to an id it cannot find.
  const selectedImage = shownId !== null && items.some(item => item.id === shownId) ? shownId : first;

  return { selectedImage, onImageChange: setShownId };
}
