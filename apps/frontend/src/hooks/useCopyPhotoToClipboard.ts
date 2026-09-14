import { useMutation } from "@tanstack/react-query";
import { useMemo } from "react";
import { serverAddress } from "../api_client/apiClient";
import { notification } from "../service/notifications";
import { canCopyImagesToClipboard, copyImageToClipboard } from "../util/imageClipboard";

type CopyPhotoArgs = {
  imageHash: string;
  /** The lightbox's cache-busting version, so a just-rotated photo is not copied from the stale cached thumbnail. */
  cacheKey?: number;
};

/**
 * Copy a photo to the clipboard and tell the user how it went.
 *
 * What gets copied is the big thumbnail, the same image the lightbox shows:
 * originals can be HEIC or RAW, which browsers cannot decode, and a 24 MP
 * JPEG re-encoded to PNG would be a very large clipboard entry. The Download
 * action remains the way to get the original file.
 *
 * `supported` is false on pages without an image clipboard (plain HTTP, old
 * browsers); callers hide the action in that case instead of letting it fail.
 */
export function useCopyPhotoToClipboard() {
  const supported = useMemo(canCopyImagesToClipboard, []);

  const mutation = useMutation({
    mutationFn: ({ imageHash, cacheKey }: CopyPhotoArgs) => {
      const version = cacheKey ? `?v=${cacheKey}` : "";
      return copyImageToClipboard(`${serverAddress}/media/thumbnails_big/${imageHash}${version}`);
    },
    onSuccess: () => notification.copyPhotoToClipboard(),
    onError: () => notification.copyPhotoToClipboardFailed(),
  });

  return { supported, isCopying: mutation.isPending, copy: mutation.mutate };
}
